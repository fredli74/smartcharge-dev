/**
 * @file Provider server loading for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2020 Fredrik Lidström
 * @license MIT (MIT)
 */
import { IProviderServer } from "./provider-server.js";
import Tesla from "./tesla/tesla-server.js";
import Nordpool from "./nordpool/nordpool-server.js";

const providers: IProviderServer[] = [Tesla, Nordpool];
export default providers;
