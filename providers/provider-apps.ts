/**
 * @file Provider app loading for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2020 Fredrik Lidström
 * @license MIT (MIT)
 */
import { IProviderApp } from "./provider-app.js";
import Tesla from "./tesla/app/tesla-app.js";
import Nordpool from "./nordpool/app/nordpool-app.js";

const providers: IProviderApp[] = [Tesla, Nordpool];
export default providers;
