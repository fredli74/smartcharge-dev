/**
 * @file Provider app loading for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2019 Fredrik Lidström
 * @license MIT (MIT)
 */
import { IProviderApp } from "./provider-app";
import Tesla from "./tesla/app/tesla-app";
import Nordpool from "./nordpool/app/nordpool-app";

const providers: IProviderApp[] = [Tesla, Nordpool];
export default providers;
