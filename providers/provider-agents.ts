import { IProviderAgent } from "./provider-agent";
import Tesla from "./tesla/tesla-agent";
import Nordpool from "./nordpool/nordpool-agent";

const providers: IProviderAgent[] = [Tesla, Nordpool];
export default providers;
