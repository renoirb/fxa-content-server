/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// this module starts it all.

/**
 * the flow:
 * 1) Initialize session information from URL search parameters.
 * 2) Fetch /config from the backend, the returned info includes a flag that
 *    indicates whether cookies are enabled.
 * 3) Fetch translations from the backend.
 * 4) Create the web/desktop communication channel.
 * 5) If cookies are disabled, go to the /cookies_disabled page.
 * 6) Start the app if cookies are enabled.
 */

define([
  'underscore',
  'backbone',
  'lib/promise',
  'uuid',
  'router',
  'lib/translator',
  'lib/session',
  'lib/url',
  'lib/config-loader',
  'lib/screen-info',
  'lib/metrics',
  'lib/storage-metrics',
  'lib/null-metrics',
  'lib/fxa-client',
  'lib/assertion',
  'lib/constants',
  'lib/oauth-client',
  'lib/oauth-errors',
  'lib/auth-errors',
  'lib/profile-client',
  'lib/marketing-email-client',
  'lib/channels/inter-tab',
  'lib/channels/iframe',
  'lib/channels/web',
  'lib/storage',
  'lib/able',
  'lib/environment',
  'lib/origin-check',
  'lib/height-observer',
  'models/reliers/relier',
  'models/reliers/oauth',
  'models/reliers/fx-desktop',
  'models/auth_brokers/base',
  'models/auth_brokers/fx-desktop',
  'models/auth_brokers/fx-desktop-v2',
  'models/auth_brokers/web-channel',
  'models/auth_brokers/redirect',
  'models/auth_brokers/iframe',
  'models/user',
  'models/form-prefill',
  'models/notifications',
  'views/close_button'
],
function (
  _,
  Backbone,
  p,
  uuid,
  Router,
  Translator,
  Session,
  Url,
  ConfigLoader,
  ScreenInfo,
  Metrics,
  StorageMetrics,
  NullMetrics,
  FxaClient,
  Assertion,
  Constants,
  OAuthClient,
  OAuthErrors,
  AuthErrors,
  ProfileClient,
  MarketingEmailClient,
  InterTabChannel,
  IframeChannel,
  WebChannel,
  Storage,
  Able,
  Environment,
  OriginCheck,
  HeightObserver,
  Relier,
  OAuthRelier,
  FxDesktopRelier,
  BaseAuthenticationBroker,
  FxDesktopV1AuthenticationBroker,
  FxDesktopV2AuthenticationBroker,
  WebChannelAuthenticationBroker,
  RedirectAuthenticationBroker,
  IframeAuthenticationBroker,
  User,
  FormPrefill,
  Notifications,
  CloseButtonView
) {
  'use strict';

  function isMetricsCollectionEnabled (sampleRate) {
    return Math.random() <= sampleRate;
  }

  function Start(options) {
    options = options || {};

    this._window = options.window || window;
    this._router = options.router;
    this._relier = options.relier;
    this._authenticationBroker = options.broker;
    this._user = options.user;

    this._history = options.history || Backbone.history;
    this._configLoader = new ConfigLoader();
  }

  Start.prototype = {
    startApp: function () {
      var self = this;

      // set UUID early so other methods can use it for metrics and ab testing purposes.
      this.initializeUuid();

      // fetch both config and translations in parallel to speed up load.
      return p.all([
        this.initializeAble(),
        this.initializeConfig(),
        this.initializeL10n(),
        this.initializeInterTabChannel()
      ])
      .then(_.bind(this.allResourcesReady, this))
      .then(function () {
        self._trackWindowOnError();
      }, function (err) {
        if (console && console.error) {
          console.error('Critical error:');
          console.error(String(err));
        }
        if (self._metrics) {
          self._metrics.logError(err);
        }

        // this extra promise is to ensure the message is printed
        // to the console in Firefox before redirecting. Without
        // the delay, the console message is lost, even with
        // persistent logs enabled. See #2183
        return p()
          .then(function () {
            //Something terrible happened. Let's bail.
            var redirectTo = self._getErrorPage(err);
            self._window.location.href = redirectTo;
          });
      });
    },

    initializeInterTabChannel: function () {
      this._interTabChannel = new InterTabChannel();
    },

    _trackWindowOnError: function () {
      var self = this;
      // if startup is okay we want to log future window.onerror events
      window.onerror = function (message /*, url, lineNumber*/) {
        var errMsg = 'null';

        if (message) {
          errMsg = message.toString().substring(0, Constants.ONERROR_MESSAGE_LIMIT);
        }

        if (self._metrics) {
          self._metrics.logEvent('error.onwindow.' +  errMsg);
        }
      };
    },

    initializeAble: function () {
      this._able = new Able();
    },

    initializeConfig: function () {
      return this._configLoader.fetch()
                    .then(_.bind(this.useConfig, this))
                    .then(_.bind(this.initializeOAuthClient, this))
                    // both the metrics and router depend on the language
                    // fetched from config.
                    .then(_.bind(this.initializeRelier, this))
                    // metrics depends on the relier.
                    .then(_.bind(this.initializeMetrics, this))
                    // iframe channel depends on the relier and metrics
                    .then(_.bind(this.initializeIframeChannel, this))
                    // fxaClient depends on the relier and
                    // inter tab communication.
                    .then(_.bind(this.initializeFxaClient, this))
                    // assertionLibrary depends on fxaClient
                    .then(_.bind(this.initializeAssertionLibrary, this))
                    // profileClient depends on fxaClient and assertionLibrary
                    .then(_.bind(this.initializeProfileClient, this))
                    // marketingEmailClient depends on config
                    .then(_.bind(this.initializeMarketingEmailClient, this))
                    // user depends on the profileClient, oAuthClient, and assertionLibrary.
                    .then(_.bind(this.initializeUser, this))
                    // broker relies on the user, relier, fxaClient,
                    // assertionLibrary, and metrics
                    .then(_.bind(this.initializeAuthenticationBroker, this))
                    // depends on the authentication broker
                    .then(_.bind(this.initializeHeightObserver, this))
                    // the close button depends on the broker
                    .then(_.bind(this.initializeCloseButton, this))
                    // storage format upgrades depend on user
                    .then(_.bind(this.upgradeStorageFormats, this))

                    // depends on nothing
                    .then(_.bind(this.initializeFormPrefill, this))
                    // depends on iframeChannel and interTabChannel
                    .then(_.bind(this.initializeNotifications, this))
                    // router depends on all of the above
                    .then(_.bind(this.initializeRouter, this));
    },

    useConfig: function (config) {
      this._config = config;
      this._configLoader.useConfig(config);
    },

    initializeL10n: function () {
      this._translator = this._window.translator = new Translator();
      return this._translator.fetch();
    },

    initializeMetrics: function () {
      var relier = this._relier;
      var screenInfo = new ScreenInfo(this._window);
      this._metrics = this._createMetrics(this._config.metricsSampleRate, {
        lang: this._config.language,
        service: relier.get('service'),
        context: relier.get('context'),
        entrypoint: relier.get('entrypoint'),
        migration: relier.get('migration'),
        campaign: relier.get('campaign'),
        clientHeight: screenInfo.clientHeight,
        clientWidth: screenInfo.clientWidth,
        devicePixelRatio: screenInfo.devicePixelRatio,
        screenHeight: screenInfo.screenHeight,
        screenWidth: screenInfo.screenWidth,
        able: this._able
      });
      this._metrics.init();
    },

    _getAllowedParentOrigins: function () {
      if (! this._isInAnIframe()) {
        return [];
      } else if (this._isFxDesktop()) {
        // If in an iframe for sync, the origin is checked against
        // a pre-defined set of origins sent from the server.
        return this._config.allowedParentOrigins;
      } else if (this._isOAuth()) {
        // If in oauth, the relier has the allowed parent origin.
        return [this._relier.get('origin')];
      }

      return [];
    },

    _checkParentOrigin: function (originCheck) {
      var self = this;
      originCheck = originCheck || new OriginCheck(self._window);
      var allowedOrigins = self._getAllowedParentOrigins();

      return originCheck.getOrigin(self._window.parent, allowedOrigins);
    },

    initializeIframeChannel: function () {
      var self = this;
      if (! self._isInAnIframe()) {
        return p();
      }

      return self._checkParentOrigin()
        .then(function (parentOrigin) {
          if (! parentOrigin) {
            // No allowed origins were found. Illegal iframe.
            throw AuthErrors.toError('ILLEGAL_IFRAME_PARENT');
          }

          var iframeChannel = new IframeChannel();
          iframeChannel.initialize({
            window: self._window,
            origin: parentOrigin,
            metrics: self._metrics
          });

          self._iframeChannel = iframeChannel;
        });
    },

    initializeFormPrefill: function () {
      this._formPrefill = new FormPrefill();
    },

    initializeOAuthClient: function () {
      this._oAuthClient = new OAuthClient({
        oAuthUrl: this._config.oAuthUrl
      });
    },

    initializeProfileClient: function () {
      this._profileClient = new ProfileClient({
        profileUrl: this._config.profileUrl
      });
    },

    initializeMarketingEmailClient: function () {
      this._marketingEmailClient = new MarketingEmailClient({
        baseUrl: this._config.marketingEmailServerUrl,
        preferencesUrl: this._config.marketingEmailPreferencesUrl
      });
    },

    initializeRelier: function () {
      if (! this._relier) {
        var relier;

        if (this._isFxDesktop()) {
          // Use the FxDesktopRelier for sync verification so that
          // the service name is translated correctly.
          relier = new FxDesktopRelier({
            window: this._window,
            translator: this._translator
          });
        } else if (this._isOAuth()) {
          relier = new OAuthRelier({
            window: this._window,
            oAuthClient: this._oAuthClient,
            session: Session
          });
        } else {
          relier = new Relier({
            window: this._window
          });
        }

        this._relier = relier;
        return relier.fetch();
      }
    },

    initializeAssertionLibrary: function () {
      this._assertionLibrary = new Assertion({
        fxaClient: this._fxaClient,
        audience: this._config.oAuthUrl
      });
    },

    initializeAuthenticationBroker: function () {
      /*eslint complexity: [2, 7] */
      if (! this._authenticationBroker) {
        if (this._isFxDesktopV2()) {
          this._authenticationBroker = new FxDesktopV2AuthenticationBroker({
            window: this._window,
            relier: this._relier,
            metrics: this._metrics
          });
        } else if (this._isFxDesktopV1()) {
          this._authenticationBroker = new FxDesktopV1AuthenticationBroker({
            window: this._window,
            relier: this._relier,
            metrics: this._metrics
          });
        } else if (this._isWebChannel()) {
          this._authenticationBroker = new WebChannelAuthenticationBroker({
            window: this._window,
            relier: this._relier,
            fxaClient: this._fxaClient,
            assertionLibrary: this._assertionLibrary,
            oAuthClient: this._oAuthClient,
            session: Session
          });
        } else if (this._isIframe()) {
          this._authenticationBroker = new IframeAuthenticationBroker({
            window: this._window,
            relier: this._relier,
            assertionLibrary: this._assertionLibrary,
            oAuthClient: this._oAuthClient,
            session: Session,
            channel: this._iframeChannel,
            metrics: this._metrics
          });
        } else if (this._isOAuth()) {
          this._authenticationBroker = new RedirectAuthenticationBroker({
            window: this._window,
            relier: this._relier,
            assertionLibrary: this._assertionLibrary,
            oAuthClient: this._oAuthClient,
            session: Session
          });
        } else {
          this._authenticationBroker = new BaseAuthenticationBroker({
            relier: this._relier
          });
        }

        this._metrics.setBrokerType(this._authenticationBroker.type);

        return this._authenticationBroker.fetch();
      }
    },

    initializeHeightObserver: function () {
      var self = this;
      if (self._isInAnIframe()) {
        var heightObserver = new HeightObserver({
          target: self._window.document.body,
          window: self._window
        });

        heightObserver.on('change', function (height) {
          self._iframeChannel.send('resize', { height: height });
        });

        heightObserver.start();
      }
    },

    initializeCloseButton: function () {
      if (this._authenticationBroker.canCancel()) {
        this._closeButton = new CloseButtonView({
          broker: this._authenticationBroker
        });
        this._closeButton.render();
      }
    },

    initializeFxaClient: function () {
      if (! this._fxaClient) {
        this._fxaClient = new FxaClient({
          interTabChannel: this._interTabChannel,
          authServerUrl: this._config.authServerUrl
        });
      }
    },

    initializeUser: function () {
      if (! this._user) {
        this._user = new User({
          oAuthClientId: this._config.oAuthClientId,
          profileClient: this._profileClient,
          oAuthClient: this._oAuthClient,
          fxaClient: this._fxaClient,
          marketingEmailClient: this._marketingEmailClient,
          assertion: this._assertionLibrary,
          storage: this._getStorageInstance()
        });
      }
    },

    initializeNotifications: function () {
      var notificationWebChannel =
            new WebChannel(Constants.ACCOUNT_UPDATES_WEBCHANNEL_ID);
      notificationWebChannel.initialize();

      this._notifications = new Notifications({
        tabChannel: this._interTabChannel,
        iframeChannel: this._iframeChannel,
        webChannel: notificationWebChannel
      });
    },

    /**
     * Sets a UUID value that is unrelated to any account information.
     * This value is useful to determine if the logged out user qualifies for ab testing or metrics.
     */
    initializeUuid: function () {
      var storage = Storage.factory('localStorage', this._window);

      // we reuse the same uuid if it is available in local storage.
      if (storage.get('uuid')) {
        this._uuid = storage.get('uuid');
      } else {
        this._uuid = uuid.v4();
        storage.set('uuid', this._uuid);
      }
    },

    upgradeStorageFormats: function () {
      return this._user.upgradeFromSession(Session, this._fxaClient);
    },

    initializeRouter: function () {
      if (! this._router) {
        this._router = new Router({
          metrics: this._metrics,
          language: this._config.language,
          relier: this._relier,
          broker: this._authenticationBroker,
          fxaClient: this._fxaClient,
          user: this._user,
          interTabChannel: this._interTabChannel,
          session: Session,
          formPrefill: this._formPrefill,
          notifications: this._notifications,
          able: this._able
        });
      }
      this._window.router = this._router;
    },

    allResourcesReady: function () {
      var self = this;
      return this._selectStartPage()
          .then(function (startPage) {
            // The IFrame cannot use pushState or else a page transition
            // would cause the parent frame to redirect.
            var usePushState = ! self._isInAnIframe();

            if (! usePushState) {
              // If pushState cannot be used, Backbone falls back to using
              // the hashchange. Put the initial pathname onto the hash
              // so the correct page loads.
              self._window.location.hash = self._window.location.pathname;
            }

            // If a new start page is specified, do not attempt to render
            // the route displayed in the URL because the user is
            // immediately redirected
            var isSilent = !! startPage;
            self._history.start({ pushState: usePushState, silent: isSilent });
            if (startPage) {
              self._router.navigate(startPage);
            }
          });
    },

    _getErrorPage: function (err) {
      if (OAuthErrors.is(err, 'MISSING_PARAMETER') ||
          OAuthErrors.is(err, 'UNKNOWN_CLIENT')) {
        var queryString = Url.objToSearchString({
          message: OAuthErrors.toInterpolatedMessage(err, this._translator),
          errno: err.errno,
          namespace: err.namespace,
          context: err.context,
          param: err.param,
          client_id: err.client_id //eslint-disable-line camelcase
        });

        return Constants.BAD_REQUEST_PAGE + queryString;
      }

      return Constants.INTERNAL_ERROR_PAGE;
    },

    _getStorageInstance: function () {
      return Storage.factory('localStorage', this._window);
    },

    _isSync: function () {
      return this._searchParam('service') === Constants.FX_DESKTOP_SYNC;
    },

    _isFxDesktopV1: function () {
      return this._searchParam('context') === Constants.FX_DESKTOP_CONTEXT;
    },

    _isFxDesktopV2: function () {
      // A user is signing into sync from within an iframe on a trusted
      // web page. Automatically speak version 2 using WebChannels.
      //
      // A check for context=fx_desktop_v2 can be added when about:accounts
      // is converted to use WebChannels.
      return this._isSync() && this._isIframeContext();
    },

    _isFxDesktop: function () {
      // In addition to the two obvious fx desktop choices, sync is always
      // considered fx-desktop. If service=sync is on the URL, it's considered
      // fx-desktop.
      return this._isFxDesktopV1() || this._isFxDesktopV2() || this._isSync();
    },

    _isWebChannel: function () {
      return !! (this._searchParam('webChannelId') || // signup/signin
                (this._isOAuthVerificationSameBrowser() &&
                  Session.oauth && Session.oauth.webChannelId));
    },

    _isInAnIframe: function () {
      return new Environment(this._window).isFramed();
    },

    _isIframeContext: function () {
      return this._searchParam('context') === Constants.IFRAME_CONTEXT;
    },

    _isIframe: function () {
      return this._isInAnIframe() && this._isIframeContext();
    },

    _isOAuth: function () {
      // for /force_auth
      return !! (this._searchParam('client_id') ||
                 // for verification flows
                 (this._searchParam('code') && this._searchParam('service')) ||
                 // for /oauth/signin or /oauth/signup
                 /oauth/.test(this._window.location.href));
    },

    _isOAuthVerificationSameBrowser: function () {
      var savedClientId = Session.oauth && Session.oauth.client_id;
      return !! (this._searchParam('code') &&
                (this._searchParam('service') === savedClientId));
    },

    _searchParam: function (name) {
      return Url.searchParam(name, this._window.location.search);
    },

    _selectStartPage: function () {
      var self = this;
      return p().then(function () {
        if (self._window.location.pathname === '/cookies_disabled') {
          // If the user is already at the cookies_disabled page, don't even
          // attempt the cookie check or else a blank screen is rendered if
          // cookies are actually disabled.
          return;
        }

        return self._configLoader.areCookiesEnabled(false, self._window)
            .then(function (areCookiesEnabled) {
              if (! areCookiesEnabled) {
                return 'cookies_disabled';
              }
            });
      });
    },

    _createMetrics: function (sampleRate, options) {
      if (this._isAutomatedBrowser()) {
        return new StorageMetrics(options);
      } else if (isMetricsCollectionEnabled(sampleRate)) {
        return new Metrics(options);
      } else {
        return new NullMetrics();
      }
    },

    _isAutomatedBrowser: function () {
      return this._searchParam('automatedBrowser') === 'true';
    }
  };

  return Start;
});
