import type { CodeMap } from '../../shared/types';
import bagButton from '../../examples/bag-demo/src/bag-button.ts?raw';
import bagPanel from '../../examples/bag-demo/src/bag-panel.ts?raw';
import bagRepository from '../../examples/bag-demo/src/bag-repository.ts?raw';
import bagRawMap from '../../examples/bag-demo/.code-detective/maps/bag-demo.json';
import loginController from '../../examples/login-demo/src/login-controller.ts?raw';
import loginValidate from '../../examples/login-demo/src/validate.ts?raw';
import loginAuth from '../../examples/login-demo/src/auth-service.ts?raw';
import loginRouter from '../../examples/login-demo/src/router.ts?raw';
import loginRawMap from '../../examples/login-demo/.code-detective/maps/login-demo.json';

function stripSchema(raw: unknown): CodeMap {
  const { $schema: _schema, ...rest } = raw as CodeMap & { $schema?: string };
  return structuredClone(rest);
}

export interface PreviewBundle {
  key: string;
  map: CodeMap;
  sources: Record<string, string>;
}

export const PREVIEW_BUNDLES: PreviewBundle[] = [
  {
    key: 'preview::login-demo',
    map: stripSchema(loginRawMap),
    sources: {
      'src/login-controller.ts': loginController,
      'src/validate.ts': loginValidate,
      'src/auth-service.ts': loginAuth,
      'src/router.ts': loginRouter,
    },
  },
  {
    key: 'preview::bag-demo',
    map: stripSchema(bagRawMap),
    sources: {
      'src/bag-button.ts': bagButton,
      'src/bag-panel.ts': bagPanel,
      'src/bag-repository.ts': bagRepository,
    },
  },
];

const requested = new URLSearchParams(globalThis.location?.search ?? '').get('map');
export const initialPreviewKey = requested === 'bag' ? 'preview::bag-demo' : 'preview::login-demo';
