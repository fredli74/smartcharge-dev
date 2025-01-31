import { SCClient } from "@shared/sc-client";
import { ConfigType } from "@shared/sc-types";

declare module "vue/types/vue" {
  interface Vue {
    $scConfig: Partial<ConfigType>;
    $scClient: SCClient;
  }
}
