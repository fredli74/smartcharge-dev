import { IProviderApp } from "./provider-app";
import Tesla from "./tesla/app/tesla-app";
import Tibber from "./tibber/app/tibber-app";

const providers: IProviderApp[] = [Tesla, Tibber];
export default providers;
