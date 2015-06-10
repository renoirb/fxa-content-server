/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * stringify and parse the `resume` token that is set in the URL
 * search parameters post-verification in the OAuth flow
 */

define([
  'underscore',
  'backbone'
], function (_, Backbone) {
  'use strict';

  function parse(resumeToken) {
    try {
      return JSON.parse(atob(resumeToken));
    } catch(e) {
      // do nothing, its an invalid token.
    }
  }

  function stringify(resumeObj) {
    var encoded = btoa(JSON.stringify(resumeObj));
    return encoded;
  }

  var ResumeToken = Backbone.Model.extend({
    defaults: {
      // fields from a relier
      state: undefined,
      verificationRedirect: undefined
    },

    initialize: function (options) {
      this.allowedKeys = Object.keys(this.defaults);

      // allow the resume token to be populated from a resume
      // query parameter.

      if (typeof options === 'string') {
        var allowedKeys = _.pick(parse(options), this.allowedKeys);
        this.set(allowedKeys);
      }
    },

    stringify: function () {
      return stringify(this.pick(this.allowedKeys));
    }
  });

  // static methods on the ResumeToken object itself, not its prototype.
  _.extend(ResumeToken, {
    parse: parse,
    stringify: stringify
  });

  return ResumeToken;
});

