import { fileURLToPath } from 'node:url';
import crowdConfig from '../vitest.config.ts';

// Crowd's resolver already supplies the shared contracts. Brain additionally
// needs its tick-request schema until the hub ships the canonical C04 module.
export default {
  ...crowdConfig,
  plugins: [
    ...crowdConfig.plugins,
    {
      name: 'rehearsal-brain-tick-request',
      enforce: 'pre',
      resolveId(id) {
        if (id === '@poltergeist/contracts/tick-request.js') {
          return fileURLToPath(
            new URL(
              '../../brain/test/shims/contracts/tick-request.ts',
              import.meta.url,
            ),
          );
        }
      },
    },
  ],
};
