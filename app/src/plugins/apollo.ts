import { SCClient } from "./sc-client";
import config from "@shared/smartcharge-config.json";

const client = new SCClient(config.SERVER_HOST);

export default client;
