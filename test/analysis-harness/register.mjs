// bootstrap for --import: registers the loader hooks
import { register } from 'node:module';
register('./loader.mjs', import.meta.url);
