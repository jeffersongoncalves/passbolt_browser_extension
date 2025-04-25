/**
 * Passbolt ~ Open source password manager for teams
 * Copyright (c) 2022 Passbolt SA (https://www.passbolt.com)
 *
 * Licensed under GNU Affero General Public License version 3 of the or any later version.
 * For full copyright and license information, please see the LICENSE.txt
 * Redistributions of files must retain the above copyright notice.
 *
 * @copyright     Copyright (c) 2022 Passbolt SA (https://www.passbolt.com)
 * @license       https://opensource.org/licenses/AGPL-3.0 AGPL License
 * @link          https://www.passbolt.com Passbolt(tm)
 * @since         3.9.0
 */
import "../../../../../test/mocks/mockSsoDataStorage";
import MockExtension from "../../../../../test/mocks/mockExtension";
import AccountEntity from "../../model/entity/account/accountEntity";
import {defaultAccountDto} from "../../model/entity/account/accountEntity.test.data";
import {defaultApiClientOptions} from "passbolt-styleguide/src/shared/lib/apiClient/apiClientOptions.test.data";
import SsoDataStorage from "../../service/indexedDB_storage/ssoDataStorage";
import GenerateSsoKitService from "../../service/sso/generateSsoKitService";
import AuthLoginController from "./authLoginController";
import {enableFetchMocks} from "jest-fetch-mock";
import {anonymousOrganizationSettings} from "../../model/entity/organizationSettings/organizationSettingsEntity.test.data";
import {mockApiResponse} from "../../../../../test/mocks/mockApiResponse";
import {defaultEmptySettings, withAzureSsoSettings} from "../sso/getCurrentSsoSettingsController.test.data";
import {clientSsoKit} from "../../model/entity/sso/ssoKitClientPart.test.data";
import PostLoginService from "../../service/auth/postLoginService";
import PassphraseStorageService from "../../service/session_storage/passphraseStorageService";
import each from "jest-each";
import AccountTemporarySessionStorageService from "../../service/sessionStorage/accountTemporarySessionStorageService";
import KeepSessionAliveService from "../../service/session_storage/keepSessionAliveService";

beforeEach(async() => {
  enableFetchMocks();
  jest.clearAllMocks();
  await MockExtension.withConfiguredAccount();
});

describe("AuthLoginController", () => {
  describe("AuthLoginController::exec", () => {
    const passphrase = "ada@passbolt.com";
    const mockOrganisationSettings = (withSsoEnabled = true) => {
      const organizationSettings = anonymousOrganizationSettings();
      organizationSettings.passbolt.plugins.sso = {
        enabled: withSsoEnabled
      };
      fetch.doMockOnceIf(new RegExp('/settings.json'), () => mockApiResponse(organizationSettings, {servertime: Date.now() / 1000}));
    };

    const mockOrganisationSettingsSsoSettings = ssoSettings => {
      fetch.doMockOnceIf(new RegExp('/sso/settings/current.json'), () => mockApiResponse(ssoSettings));
    };

    each([
      {scenario: 'remember me true', passphrase: passphrase, rememberMe: true, shouldRefreshCurrentTab: true},
      {scenario: 'remember me true, no tab refresh', passphrase: passphrase, rememberMe: true, shouldRefreshCurrentTab: false},
      {scenario: 'remember me false', passphrase: passphrase, rememberMe: false, shouldRefreshCurrentTab: true},
      {scenario: 'remember me false, no tab refresh', passphrase: passphrase, rememberMe: false, shouldRefreshCurrentTab: false},
    ]).describe("Should sign-in the user.", test => {
      it(`Sign in with ${test.scenario}`, async() => {
        mockOrganisationSettings(false);

        const account = new AccountEntity(defaultAccountDto());
        const controller = new AuthLoginController({tab: {id: 1}}, null, defaultApiClientOptions(), account);

        jest.spyOn(controller.authVerifyLoginChallengeService, "verifyAndValidateLoginChallenge").mockImplementationOnce(jest.fn());
        jest.spyOn(PassphraseStorageService, "set").mockImplementation(async() => {});
        jest.spyOn(PostLoginService, "exec").mockImplementation(async() => {});
        jest.spyOn(browser.tabs, "update");
        jest.spyOn(AccountTemporarySessionStorageService, "remove");
        jest.spyOn(KeepSessionAliveService, "start").mockImplementation(async() => {});

        expect.assertions(4);

        await controller.exec(test.passphrase, test.rememberMe, test.shouldRefreshCurrentTab);
        expect(controller.authVerifyLoginChallengeService.verifyAndValidateLoginChallenge).toHaveBeenCalledWith(account.userKeyFingerprint, account.userPrivateArmoredKey, test.passphrase);
        if (test.rememberMe) {
          expect(PassphraseStorageService.set).toHaveBeenCalledWith(test.passphrase, -1);
        } else {
          expect(PassphraseStorageService.set).toHaveBeenCalledWith(test.passphrase, 60);
        }
        if (test.shouldRefreshCurrentTab) {
          expect(browser.tabs.update).toHaveBeenCalledWith(1, {url: account.domain});
        } else {
          expect(browser.tabs.update).not.toHaveBeenCalled();
        }
        expect(PostLoginService.exec).toHaveBeenCalledTimes(1);
      });
    });

    it("Should throw an exception if the passphrase is not a valid.", async() => {
      const account = new AccountEntity(defaultAccountDto());
      const controller = new AuthLoginController(null, null, defaultApiClientOptions(), account);

      expect.assertions(2);
      const promiseMissingParameter = controller.exec();
      await expect(promiseMissingParameter).rejects.toThrowError("A passphrase is required.");
      const promiseInvalidTypeParameter = controller.exec(2);
      await expect(promiseInvalidTypeParameter).rejects.toThrowError("The passphrase should be a string.");
    }, 10000);

    it("Should throw an exception if the provided remember me is not a valid boolean.", async() => {
      const account = new AccountEntity(defaultAccountDto());
      const controller = new AuthLoginController(null, null, defaultApiClientOptions(), account);

      expect.assertions(1);
      const promiseInvalidTypeParameter = controller.exec("passphrase", 42);
      await expect(promiseInvalidTypeParameter).rejects.toThrowError("The rememberMe should be a boolean.");
    }, 10000);

    it("Should sign-in the user and not generate an SSO kit if SSO organization settings is disabled.", async() => {
      expect.assertions(1);
      SsoDataStorage.setMockedData(null);
      jest.spyOn(GenerateSsoKitService, "generate");
      mockOrganisationSettings(false);

      const account = new AccountEntity(defaultAccountDto());
      const controller = new AuthLoginController(null, null, defaultApiClientOptions(), account);
      jest.spyOn(controller.authVerifyLoginChallengeService, "verifyAndValidateLoginChallenge").mockImplementationOnce(jest.fn());

      await controller.exec(passphrase, true);
      expect(GenerateSsoKitService.generate).not.toHaveBeenCalled();
    });

    it("Should sign-in the user and not generate an SSO kit if SSO organization settings is enabled and a kit already exists.", async() => {
      expect.assertions(1);
      SsoDataStorage.setMockedData(await clientSsoKit());
      jest.spyOn(GenerateSsoKitService, "generate");
      mockOrganisationSettings(true);
      mockOrganisationSettingsSsoSettings(withAzureSsoSettings());

      const account = new AccountEntity(defaultAccountDto());
      const controller = new AuthLoginController(null, null, defaultApiClientOptions(), account);
      jest.spyOn(controller.authVerifyLoginChallengeService, "verifyAndValidateLoginChallenge").mockImplementationOnce(jest.fn());

      await controller.exec(passphrase, true);
      expect(GenerateSsoKitService.generate).not.toHaveBeenCalled();
    });

    it("Should sign-in the user and generate an SSO kit if SSO organization settings is enabled and a kit is not available.", async() => {
      expect.assertions(2);
      SsoDataStorage.setMockedData(null);
      const ssoSettingsDto = withAzureSsoSettings();
      jest.spyOn(GenerateSsoKitService, "generate");
      mockOrganisationSettings(true);
      mockOrganisationSettingsSsoSettings(ssoSettingsDto);

      const account = new AccountEntity(defaultAccountDto());
      const controller = new AuthLoginController(null, null, defaultApiClientOptions(), account);
      jest.spyOn(controller.authVerifyLoginChallengeService, "verifyAndValidateLoginChallenge").mockImplementationOnce(jest.fn());

      await controller.exec(passphrase, true);
      expect(GenerateSsoKitService.generate).toHaveBeenCalledTimes(1);
      expect(GenerateSsoKitService.generate).toHaveBeenCalledWith(passphrase, ssoSettingsDto.provider);
    });

    it("Should sign-in the user and flush SSO kit data if a kit is available locally and the SSO is not configured for the organisation.", async() => {
      expect.assertions(1);
      SsoDataStorage.setMockedData(await clientSsoKit());
      mockOrganisationSettings(true);
      mockOrganisationSettingsSsoSettings(defaultEmptySettings());

      const account = new AccountEntity(defaultAccountDto());
      const controller = new AuthLoginController(null, null, defaultApiClientOptions(), account);
      jest.spyOn(controller.authVerifyLoginChallengeService, "verifyAndValidateLoginChallenge").mockImplementationOnce(jest.fn());

      await controller.exec(passphrase, true);
      expect(SsoDataStorage.flush).toHaveBeenCalledTimes(1);
    });

    it("Should sign-in the user and flush SSO kit data if a kit is available locally and the organization settings is disabled.", async() => {
      expect.assertions(1);
      SsoDataStorage.setMockedData(await clientSsoKit());
      mockOrganisationSettings(false);

      const account = new AccountEntity(defaultAccountDto());
      const controller = new AuthLoginController(null, null, defaultApiClientOptions(), account);
      jest.spyOn(controller.authVerifyLoginChallengeService, "verifyAndValidateLoginChallenge").mockImplementationOnce(jest.fn());

      await controller.exec(passphrase, true);
      expect(SsoDataStorage.flush).toHaveBeenCalledTimes(1);
    });
  });
});
