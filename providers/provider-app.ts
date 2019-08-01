import { IProvider } from ".";
import { VueConstructor } from "vue";
import { Vue } from "vue-property-decorator";

export type ProviderVuePage = "new" | "config" | "view";

export interface IProviderApp extends IProvider {
  logo: any;
  image: any;
  vue: VueConstructor<Vue>;
}
