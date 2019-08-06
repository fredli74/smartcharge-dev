import { IProviderAgent } from "./provider-agent";
import Tesla from "./tesla/tesla-agent";
import Tibber from "./tibber/tibber-agent";

const providers: IProviderAgent[] = [Tesla, Tibber];
export default providers;
