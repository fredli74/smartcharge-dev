/**
 * @file Provider server loading for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2020 Fredrik Lidström
 * @license MIT (MIT)
 */
import { IProviderServer } from "./provider-server";
import Tesla from "./tesla/tesla-server";
import Nordpool from "./nordpool/nordpool-server";

const providers: IProviderServer[] = [Tesla, Nordpool];
export default providers;
