// youtubei.js for a web page, told to behave as it does on a server: set its own User-Agent and
// Origin. Those requests go through the phone, which can send them.
import { Innertube, Log, Constants, Utils } from 'youtubei.js/web';

Utils.Platform.load({ ...Utils.Platform.shim, server: true, fetch: (...args) => window.fetch(...args) });

export { Innertube, Log, Constants };
