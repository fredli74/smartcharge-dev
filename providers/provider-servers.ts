import { IProviderServer } from "./provider-server";
import Tesla from "./tesla/tesla-server";
import Nordpool from "./nordpool/nordpool-server";

const providers: IProviderServer[] = [Tesla, Nordpool];
export default providers;
