/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

define([
  'chai',
  'models/reliers/base'
], function (chai, BaseRelier) {
  'use strict';

  var assert = chai.assert;

  describe('models/reliers/base', function () {
    var relier;

    beforeEach(function () {
      relier = new BaseRelier();
    });

    describe('fetch', function () {
      it('returns a promise', function () {
        return relier.fetch()
          .then(assert.pass);
      });
    });

    describe('isDirectAccess', function () {
      it('returns false if `service` is set', function () {
        relier.set('service', 'serviceName');
        assert.isFalse(relier.isDirectAccess());
      });

      it('returns true if `service` is unset', function () {
        assert.isTrue(relier.isDirectAccess());
      });
    });

    describe('isOAuth', function () {
      it('returns `false`', function () {
        assert.isFalse(relier.isOAuth());
      });
    });

    describe('isFxDesktop', function () {
      it('returns `false`', function () {
        assert.isFalse(relier.isFxDesktop());
      });
    });

    describe('isSync', function () {
      it('returns `false`', function () {
        assert.isFalse(relier.isSync());
      });
    });

    describe('wantsKeys', function () {
      it('returns `false`', function () {
        assert.isFalse(relier.wantsKeys());
      });
    });

    describe('deriveRelierKeys', function () {
      it('returns no keys', function () {
        relier.deriveRelierKeys('uid', { kA: 'kA', kB: 'kB' })
          .then(function (keys) {
            assert.equal(keys, {});
          });
      });
    });

    describe('isCustomizeSyncChecked', function () {
      it('returns `false`', function () {
        assert.isFalse(relier.isCustomizeSyncChecked());
      });
    });

    describe('getResumeToken', function () {
      it('returns null', function () {
        assert.isNull(relier.getResumeToken());
      });
    });

    describe('allowCachedCredentials', function () {
      it('returns `true`', function () {
        assert.isTrue(relier.allowCachedCredentials());
      });
    });

    describe('isTrusted', function () {
      it('returns `true`', function () {
        assert.isTrue(relier.isTrusted());
      });
    });

    describe('accountNeedsPermissions', function () {
      it('returns `false`', function () {
        assert.isFalse(relier.accountNeedsPermissions());
      });
    });
  });
});

