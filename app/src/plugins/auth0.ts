/**
 * @file Auth0 authentication handler for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2025 Fredrik Lidström
 * @license MIT (MIT)
 */

// TODO: Authentication is a bit spaghetti because I started out with single_user mode and then added Auth0 on top.
// Should be possible to clean up and make better authentication

import auth0 from "auth0-js";
import EventEmitter from "eventemitter3";
import Vue from "vue";

class AuthService extends EventEmitter {
  webAuth: auth0.WebAuth | undefined;

  lazyLoad(): auth0.WebAuth {
    if (!this.webAuth) {
      this.webAuth = new auth0.WebAuth({
        domain: Vue.prototype.$scConfig.AUTH0_DOMAIN,
        clientID: Vue.prototype.$scConfig.AUTH0_CLIENT_ID,
        redirectUri: `${window.location.origin}/login`,
        responseType: "id_token",
        scope: "profile openid",
      });
    }
    return this.webAuth;
  }
  
  // Starts the user login flow
  login(customState?: any) {
    const auth = this.lazyLoad();
    auth.authorize({
      appState: customState,
    });
  }
  logout() {
    const auth = this.lazyLoad();
    auth.logout({ returnTo: `${window.location.origin}/` });
  }
  // Handles the callback request from Auth0
  async handleAuthentication(): Promise<string | null> {
    const auth = this.lazyLoad();
    return new Promise((resolve, reject) => {
      auth.parseHash((err, authResult) => {
        if (err) {
          reject(err);
        } else {
          resolve((authResult && authResult.idToken) || null);
        }
      });
    });
  }
}

export default new AuthService();
