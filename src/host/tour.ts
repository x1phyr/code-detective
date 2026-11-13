import * as vscode from 'vscode';
import type { CodeMap, SourceRef, SourceStatus } from '../../shared/types';
import { tourView, type TourStepView } from '../core/tour';
import { questionPrompt } from '../ai/question';
import { createSession } from '../ai';
import { readAiConfig } from '../ai/config';
import type { AgentCancel, AgentSession } from '../ai/types';
import { errorMessage } from '../core/errors';
import { t } from '../../shared/i18n';
import { sourceRange } from './highlights';
import type { TourPosition } from '../core/tour';

/** 评论控制器 id；package.json 里的菜单用 `commentController == codeDetective.tour` 匹配它。 */
export const TOUR_CONTROLLER_ID = 'codeDetective.tour';

export interface TourGuideHooks {
  root(): vscode.WorkspaceFolder | undefined;
  log(line: string): void;
}

interface Exchange {
  question: string;
  answer: string;
}

/**
 * 编辑器里的“带读”面板。
 *
 * 每一步在它指向的那段代码下方展开一个评论面板：讲解（是什么 / 为什么 / 注意 / 可跳过 / 例子）、
 * 进度、可以走的岔路，以及一个回复框——在回复框里提问，本机 agent 会结合当前这一步回答，
 * 问答留在这一步的面板里，切走再回来还在。
 */
export class TourGuide implements vscode.Disposable {
  private readonly controller: vscode.CommentController;
  private thread?: vscode.CommentThread;
  private map?: CodeMap;
  private position?: TourPosition;
  private view?: TourStepView;
  /** 每一步的问答（按地图 + 步骤记），同一会话内保留。 */
  private readonly answers = new Map<string, Exchange[]>();
  /** 一张地图一个 agent 会话：追问可以接着上一轮，不必重读代码。 */
  private sessions = new Map<string, AgentSession>();
  private pending?: vscode.CancellationTokenSource;

  constructor(private readonly hooks: TourGuideHooks) {
    this.controller = vscode.comments.createCommentController(TOUR_CONTROLLER_ID, t('host.tourControllerLabel'));
    this.controller.options = {
      prompt: t('host.tourAskPrompt'),
      placeHolder: t('host.tourAskPlaceholder'),
    };
  }

  get active(): boolean {
    return this.thread !== undefined;
  }

  /** 在编辑器里展示这一步。`status` 是源码当前（可能已漂移后的）位置。 */
  show(map: CodeMap, position: TourPosition, document: vscode.TextDocument, status: SourceStatus | undefined): void {
    const view = tourView(map, position);
    if (!view) return this.close();
    this.map = map;
    this.position = position;
    this.view = view;
    const range = status ? sourceRange(document, status) : undefined;
    // 面板挂在这段代码的最后一行下方，讲解紧贴着正在看的代码。
    const anchor = range ? new vscode.Range(range.end.line, 0, range.end.line, 0) : new vscode.Range(0, 0, 0, 0);
    if (this.thread && this.thread.uri.toString() === document.uri.toString()) {
      this.thread.range = anchor;
    } else {
      this.thread?.dispose();
      this.thread = this.controller.createCommentThread(document.uri, anchor, []);
    }
    this.thread.canReply = true;
    this.thread.contextValue = 'tourStep';
    this.thread.label = view.step.aside
      ? t('host.tourLabelAside', { title: view.step.title })
      : t('host.tourLabel', { index: view.index, total: view.total, title: view.step.title });
    this.thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
    this.render();
  }

  /** 源码不可用（文件缺失等）时也要能继续：把面板挂在文件开头。 */
  showWithoutSource(map: CodeMap, position: TourPosition, document: vscode.TextDocument): void {
    this.show(map, position, document, undefined);
  }

  close(): void {
    this.pending?.cancel();
    this.pending = undefined;
    this.thread?.dispose();
    this.thread = undefined;
    this.view = undefined;
    this.position = undefined;
  }

  /** 换地图或地图被删除时丢掉旧会话，避免把旧上下文带进新问题。 */
  reset(): void {
    this.close();
    this.answers.clear();
    this.sessions = new Map();
  }

  /** 回复框提交：本机 agent 结合当前这一步回答。 */
  async ask(reply: vscode.CommentReply): Promise<void> {
    const question = reply.text.trim();
    const map = this.map;
    const view = this.view;
    if (!question || !map || !view || reply.thread !== this.thread) return;
    const root = this.hooks.root();
    if (!root) {
      void vscode.window.showWarningMessage(t('host.openWorkspaceFirst'));
      return;
    }
    const key = `${map.id}::${view.step.id}`;
    const history = this.answers.get(key) ?? [];
    const exchange: Exchange = { question, answer: '' };
    history.push(exchange);
    this.answers.set(key, history);
    this.pending?.cancel();
    const source = new vscode.CancellationTokenSource();
    this.pending = source;
    this.render(true);

    const cancel: AgentCancel = {
      get isCancellationRequested() { return source.token.isCancellationRequested; },
      onCancellationRequested: listener => source.token.onCancellationRequested(listener),
    };
    try {
      const config = readAiConfig();
      let session = this.sessions.get(map.id);
      if (!session) {
        session = createSession(config);
        this.sessions.set(map.id, session);
      }
      const ref: SourceRef | undefined = view.sourceId ? map.sources[view.sourceId] : undefined;
      const reply = await session.send({
        prompt: questionPrompt({
          map,
          step: view.step,
          source: ref,
          index: view.index,
          total: view.total,
          history: history.slice(0, -1),
          question,
        }),
        cwd: root.uri.fsPath,
        timeoutMs: config.timeoutMs,
        cancel,
      });
      exchange.answer = reply.text.trim() || t('host.tourEmptyAnswer');
    } catch (error) {
      if (source.token.isCancellationRequested) {
        history.splice(history.indexOf(exchange), 1);
      } else {
        exchange.answer = t('host.tourAnswerFailed', { message: errorMessage(error) });
        this.hooks.log(t('host.tourAnswerFailed', { message: errorMessage(error) }));
      }
    } finally {
      if (this.pending === source) this.pending = undefined;
      source.dispose();
    }
    // 回答期间用户可能已经换到别的步骤；只有还在这一步时才刷新面板。
    if (this.view?.step.id === view.step.id && this.map?.id === map.id) this.render();
  }

  private render(thinking = false): void {
    const thread = this.thread;
    const view = this.view;
    const map = this.map;
    if (!thread || !view || !map) return;
    const guide: vscode.Comment = {
      body: this.body(map, view),
      mode: vscode.CommentMode.Preview,
      author: { name: t('host.tourAuthor') },
      contextValue: 'tourGuide',
    };
    const comments: vscode.Comment[] = [guide];
    const history = this.answers.get(`${map.id}::${view.step.id}`) ?? [];
    history.forEach((item, index) => {
      comments.push({ body: item.question, mode: vscode.CommentMode.Preview, author: { name: t('host.tourYou') } });
      const waiting = thinking && index === history.length - 1;
      if (item.answer || waiting) {
        comments.push({
          body: waiting ? new vscode.MarkdownString(t('host.tourThinking'), true) : item.answer,
          mode: vscode.CommentMode.Preview,
          author: { name: t('host.tourAuthor') },
        });
      }
    });
    thread.comments = comments;
  }

  private body(map: CodeMap, view: TourStepView): vscode.MarkdownString {
    const step = view.step;
    const md = new vscode.MarkdownString('', true);
    // 只允许本插件的导航命令，不放开任意命令链接。
    md.isTrusted = { enabledCommands: ['codeDetective.nextStep', 'codeDetective.previousStep', 'codeDetective.tourBranch', 'codeDetective.stopWalkthrough'] };
    md.supportThemeIcons = true;
    const first = !view.step.aside && view.index === 1;
    if (first && map.tour?.example) {
      md.appendMarkdown(`$(beaker) **${t('host.tourExample')}**　`);
      md.appendText(map.tour.example);
      md.appendMarkdown('\n\n---\n\n');
    }
    if (step.description) {
      md.appendText(step.description);
      md.appendMarkdown('\n\n');
    }
    const section = (icon: string, title: string, text: string | undefined): void => {
      if (!text) return;
      md.appendMarkdown(`$(${icon}) **${title}**　`);
      md.appendText(text);
      md.appendMarkdown('\n\n');
    };
    section('beaker', t('host.tourExampleHere'), step.example);
    section('lightbulb', t('host.tourWhy'), step.why);
    section('warning', t('host.tourWatch'), step.watch);
    section('eye-closed', t('host.tourSkip'), step.skip);

    if (view.branches.length) {
      md.appendMarkdown(`$(git-branch) **${t('host.tourBranches')}**　`);
      md.appendMarkdown(view.branches.map(branch => this.link(branch.title, 'codeDetective.tourBranch', [branch.id])).join('　·　'));
      md.appendMarkdown('\n\n');
    }
    if (view.last) {
      if (map.tour?.recap) {
        md.appendMarkdown(`---\n\n$(checklist) **${t('host.tourRecap')}**\n\n`);
        md.appendText(map.tour.recap);
        md.appendMarkdown('\n\n');
      }
      if (map.tour?.exercise) {
        md.appendMarkdown(`$(tools) **${t('host.tourExercise')}**\n\n`);
        md.appendText(map.tour.exercise);
        md.appendMarkdown('\n\n');
      }
    }

    const nav: string[] = [];
    if (view.step.aside && view.returnTo) {
      nav.push(this.link(`$(arrow-left) ${t('host.tourBack', { title: view.returnTo.title })}`, 'codeDetective.previousStep'));
    } else if (view.previous) {
      nav.push(this.link(`$(arrow-left) ${t('host.tourPrevious')}`, 'codeDetective.previousStep'));
    }
    if (view.next && !view.step.aside) nav.push(this.link(`${t('host.tourNext')} $(arrow-right)`, 'codeDetective.nextStep'));
    if (view.last || (!view.next && !view.step.aside)) nav.push(this.link(`$(check) ${t('host.tourFinish')}`, 'codeDetective.stopWalkthrough'));
    md.appendMarkdown(`---\n\n${nav.join('　　')}　　<small>${t('host.tourKeys', { mod: process.platform === 'darwin' ? '⌥' : 'Alt+' })}</small>`);
    md.supportHtml = true;
    return md;
  }

  private link(label: string, command: string, args?: unknown[]): string {
    const query = args ? `?${encodeURIComponent(JSON.stringify(args))}` : '';
    return `[${label}](command:${command}${query})`;
  }

  dispose(): void {
    this.close();
    this.controller.dispose();
  }
}
