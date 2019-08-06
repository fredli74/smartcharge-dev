import { RestToken } from "@shared/restclient";
import config from "../tibber-config";

export async function getHomes(token: RestToken) {
  const rawResponse = await fetch(config.TIBBER_API_BASE_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      query: `{ viewer { homes { id appNickname type } } }`
    })
  });
  const content = await rawResponse.json();
  if (content.data && content.data.viewer && content.data.viewer.homes) {
    return content.data.viewer.homes;
  }
  throw new Error(
    (content.errors && content.errors[0] && content.errors[0].message) ||
      "Error getting Tibber homes"
  );
}
