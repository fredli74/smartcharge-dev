import { IProviderApp } from "./provider-app";
import Tesla from "./tesla/app/tesla-app";
import Nordpool from "./nordpool/app/nordpool-app";

const providers: IProviderApp[] = [Tesla, Nordpool];
export default providers;
