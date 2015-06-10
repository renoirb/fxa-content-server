/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

define([
  'chai',
  'models/resume-token'
],
function (chai, ResumeToken) {
  'use strict';

  var assert = chai.assert;

  var TOKEN_OBJ = {
    state: 'STATE'
  };

  describe('models/resume-token', function () {
    describe('ResumeToken.stringify', function () {
      it('stringifies an object into an opaque token', function () {
        assert.ok(ResumeToken.stringify(TOKEN_OBJ));
      });
    });

    describe('ResumeToken.parse', function () {
      it('converts the stringified opaque token into an object', function () {
        var stringifiedToken = ResumeToken.stringify(TOKEN_OBJ);
        var parsedToken = ResumeToken.parse(stringifiedToken);
        assert.deepEqual(parsedToken, TOKEN_OBJ);
      });

      it('returns nothing if the token is invalid', function () {
        assert.isUndefined(ResumeToken.parse('asdf'));
      });
    });

    describe('creation from a string', function () {
      it('should parse the string and populate the resume token', function () {
        var resumeString = ResumeToken.stringify(TOKEN_OBJ);
        var resumeToken = new ResumeToken(resumeString);
        assert.equal(resumeToken.get('state'), 'STATE');
      });

      it('should ignore fields that are not explicitly allowed', function () {
        var resumeString = ResumeToken.stringify({
          state: 'STATE',
          ignored: true
        });
        var resumeToken = new ResumeToken(resumeString);
        assert.isFalse(resumeToken.has('ignored'));
      });
    });

    describe('stringify', function () {
      it('should stringify explicitly allowed fields', function () {
        var resumeToken = new ResumeToken({
          state: 'STATE',
          notStringified: true
        });

        // the value is saved, but not stringified.
        assert.equal(resumeToken.get('notStringified'), true);

        var stringified = resumeToken.stringify();
        var parsed = ResumeToken.parse(stringified);
        assert.equal(parsed.state, 'STATE');
        assert.isFalse('notStringified' in parsed);
      });
    });
  });
});
