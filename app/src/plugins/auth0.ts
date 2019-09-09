/**
 * @file Auth0 authentication handler for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2019 Fredrik Lidström
 * @license MIT (MIT)
 */

// TODO: Authentication is a bit spaghetti because I started out with single_user mode and then added Auth0 on top.
// Should be possible to clean up and make better authentication

import auth0 from "auth0-js";
import EventEmitter from "events";
import config from "@shared/smartcharge-config";

const webAuth = new auth0.WebAuth({
  domain: config.AUTH0_DOMAIN,
  clientID: config.AUTH0_CLIENT_ID,
  redirectUri: `${window.location.origin}/login`,
  responseType: "id_token",
  scope: "profile openid"
});

class AuthService extends EventEmitter {
  // Starts the user login flow
  login(customState?: any) {
    webAuth.authorize({
      appState: customState
    });
  }
  logout() {
    webAuth.logout({ returnTo: `${window.location.origin}/` });
  }
  // Handles the callback request from Auth0
  async handleAuthentication(): Promise<string | null> {
    return new Promise((resolve, reject) => {
      webAuth.parseHash((err, authResult) => {
        if (err) {
          reject(err);
        } else {
          resolve(authResult && authResult.idToken);
        }
      });
    });
  }
}

export default new AuthService();