import type { CodeMap } from '../../shared/types';
import bagButton from '../../examples/bag-demo/src/bag-button.ts?raw';
import bagPanel from '../../examples/bag-demo/src/bag-panel.ts?raw';
import bagRepository from '../../examples/bag-demo/src/bag-repository.ts?raw';
import loginController from '../../examples/login-demo/src/login-controller.ts?raw';
import loginValidate from '../../examples/login-demo/src/validate.ts?raw';
import loginAuth from '../../examples/login-demo/src/auth-service.ts?raw';
import loginRouter from '../../examples/login-demo/src/router.ts?raw';
import loginMap from '../../examples/login-demo/.code-detective/maps/login-demo.json';

/**
 * 浏览器预览直接复用 examples/bag-demo 的地图内容与源码，
 * 这样右侧只读源码视图和真实示例保持一致。
 */
const bagMap: CodeMap = {
  schemaVersion: 1,
  id: 'bag-demo',
  title: '背包打开流程',
  description: '从点击背包按钮，到加载资源、读取数据，再到刷新物品列表的示例流程。',
  sources: {
    'button.bind': { file: 'src/bag-button.ts', startLine: 3, endLine: 7 },
    'button.id': { file: 'src/bag-button.ts', startLine: 9, endLine: 9 },
    'panel.open': { file: 'src/bag-panel.ts', startLine: 6, endLine: 11 },
    'panel.refresh': { file: 'src/bag-panel.ts', startLine: 17, endLine: 21 },
    'panel.read': { file: 'src/bag-panel.ts', startLine: 23, endLine: 27 },
    'repo.load': { file: 'src/bag-repository.ts', startLine: 5, endLine: 12 },
    'repo.fallback': { file: 'src/bag-repository.ts', startLine: 14, endLine: 16 },
  },
  nodes: [
    {
      id: 'click',
      label: '点击背包按钮',
      kind: 'event',
      description: '按钮的点击回调触发打开面板。',
      sourceIds: ['button.bind', 'button.id'],
    },
    {
      id: 'open',
      label: '创建并打开面板',
      kind: 'function',
      description: '先加载界面资源，再请求物品数据。',
      sourceIds: ['panel.open'],
    },
    {
      id: 'read',
      label: '读取背包数据',
      kind: 'function',
      description: '优先使用缓存，未命中时请求接口。',
      sourceIds: ['panel.read', 'repo.load'],
    },
    {
      id: 'fallback',
      label: '未命中时调用',
      kind: 'condition',
      description: '接口没有返回数据时使用兜底内容。',
      sourceIds: ['repo.fallback'],
    },
    {
      id: 'refresh',
      label: '刷新物品列表',
      kind: 'step',
      description: '把物品渲染到面板中。',
      sourceIds: ['panel.refresh'],
    },
  ],
  edges: [
    { id: 'e.click-open', from: 'click', to: 'open', label: '打开面板', kind: 'flow', sourceIds: ['button.bind'] },
    { id: 'e.open-read', from: 'open', to: 'read', label: '请求数据', kind: 'call', sourceIds: ['panel.open', 'panel.read'] },
    { id: 'e.read-fallback', from: 'read', to: 'fallback', label: '未命中时调用', kind: 'flow', sourceIds: ['repo.fallback'] },
    { id: 'e.read-refresh', from: 'read', to: 'refresh', label: '返回结果', kind: 'flow', sourceIds: ['panel.refresh', 'repo.load'] },
    { id: 'e.fallback-refresh', from: 'fallback', to: 'refresh', label: '兜底后刷新', kind: 'flow', sourceIds: ['panel.refresh'] },
  ],
  walkthrough: [
    {
      id: 'step-open',
      title: '从按钮到界面',
      description: '点击按钮后创建面板并加载资源。',
      nodeIds: ['click', 'open'],
      edgeIds: ['e.click-open'],
    },
    {
      id: 'step-read',
      title: '读取数据',
      description: '面板读取缓存或请求接口，未命中时走兜底。',
      nodeIds: ['read', 'fallback'],
      edgeIds: ['e.open-read', 'e.read-fallback'],
    },
    {
      id: 'step-refresh',
      title: '刷新列表',
      description: '数据到达后渲染物品。',
      nodeIds: ['refresh'],
      edgeIds: ['e.read-refresh', 'e.fallback-refresh'],
    },
  ],
};

const bagSourceText: Record<string, string> = {
  'src/bag-button.ts': bagButton,
  'src/bag-panel.ts': bagPanel,
  'src/bag-repository.ts': bagRepository,
};

const loginSourceText: Record<string, string> = {
  'src/login-controller.ts': loginController,
  'src/validate.ts': loginValidate,
  'src/auth-service.ts': loginAuth,
  'src/router.ts': loginRouter,
};

/** 浏览器预览默认展示背包示例；地址栏加 `?map=login` 切到分层更深的登录示例。 */
const loginDemo = loginMap as unknown as CodeMap & { $schema?: string };

const useLogin = new URLSearchParams(globalThis.location?.search ?? '').get('map') === 'login';

export const demoMap: CodeMap = useLogin ? (({ $schema: _schema, ...rest }) => rest)(loginDemo) : bagMap;
export const demoSourceText: Record<string, string> = useLogin ? loginSourceText : bagSourceText;
