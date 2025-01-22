/**
 * @file Provider agent loading for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2020 Fredrik Lidström
 * @license MIT (MIT)
 */
import { IProviderAgent } from "./provider-agent.js";
import Tesla from "./tesla/tesla-agent.js";
import Nordpool from "./nordpool/nordpool-agent.js";

const providers: IProviderAgent[] = [Tesla, Nordpool];
export default providers;
