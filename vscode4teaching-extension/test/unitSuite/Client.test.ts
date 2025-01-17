import axios, { AxiosRequestConfig, AxiosResponse } from "axios";
import * as fs from "fs";
import * as mkdirp from "mkdirp";
import * as path from "path";
import rimraf from "rimraf";
import { mocked } from "ts-jest/utils";
import * as vscode from "vscode";
import { APIClient } from "../../src/client/APIClient";
import { APIClientSession } from "../../src/client/APIClientSession";
import { CurrentUser } from "../../src/client/CurrentUser";
import { CoursesProvider } from "../../src/components/courses/CoursesTreeProvider";
import { UserSignup } from "../../src/model/serverModel/user/UserSignup";
import { v4tLogger } from "../../src/services/LoggerService";

jest.mock("axios");
const mockedAxios = mocked(axios, true);
mockedAxios.CancelToken.source = jest.fn();
jest.mock("../../src/client/CurrentUser");
const mockedCurrentUser = mocked(CurrentUser, true);
jest.mock("../../src/components/courses/CoursesTreeProvider");
const mockedCoursesTreeProvider = mocked(CoursesProvider, true);
jest.mock("vscode");
const mockedVscode = mocked(vscode, true);
jest.mock("../../src/services/LoggerService");
const mockedLogger = mocked(v4tLogger, true);
const baseURL = "https://edukafora.codeurjc.es";
const xsrfToken = "testToken";
const jwtToken = "testToken";

// Helper method to initialize a session file
function createSessionFile(newXsrfToken: string, newJwtToken: string) {
    const v4tPath = path.resolve(APIClientSession.sessionPath, "..");
    if (!fs.existsSync(v4tPath)) {
        mkdirp.sync(v4tPath);
    }
    fs.writeFileSync(APIClientSession.sessionPath, newJwtToken + "\n" + newXsrfToken);
}

function expectSessionInvalidated(isInvalidated: boolean) {
    if (isInvalidated) {
        // Session is invalidated
        expect(mockedCurrentUser.resetUserInfo).toHaveBeenCalledTimes(1);
        expect(fs.existsSync(APIClientSession.sessionPath)).toBeFalsy();
    } else {
        // Session is not invalidated
        expect(mockedCurrentUser.resetUserInfo).toHaveBeenCalledTimes(0);
        expect(fs.existsSync(APIClientSession.sessionPath)).toBeTruthy();
    }
}

describe("Client", () => {
    beforeEach(() => {
        jest.clearAllMocks();

        createSessionFile(xsrfToken, jwtToken);
        APIClientSession.initializeSessionCredentials();
    });

    afterEach(() => {
        APIClient.invalidateSession();
        const v4tPath = path.resolve(__dirname, "..", "..", "src", "v4t");
        if (fs.existsSync(v4tPath)) {
            rimraf(v4tPath, (error: any) => {
                // console.error(error);
            });
        }

        mockedAxios.mockReset();
        mockedLogger.error = jest.fn();
    });

    it("should log in", async () => {
        const username = "johndoe";
        const password = "password";
        const newUrl = "https://edukafora.codeurjc.es";
        const newXsrfToken = "29f6caf7-b522-4730-87c4-bfb1b3db0e66";
        const newJwtToken = "eyJhbGciOiJIUzUxMiJ9.eyJzdWIiOiJqb2huZG9lIiwiZXhwIjoxNTg0NTc0MDI4LCJpYXQiOjE1ODQ1NTYwMjh9.xH_aiuU73NLfSamv-k7Le20XYL9Zr2VHaMtUQMPhBo5K7E_YUVlQ5WBJ4UkEcqYrB9Sqeh8OK-ShWDagDqVtNA";
        const expectedAxiosConfigXSRFRequest: AxiosRequestConfig = {
            baseURL: newUrl,
            url: "/api/csrf",
            method: "GET",
            headers: {},
            responseType: "json",
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
        };
        const expectedAxiosConfigLoginRequest: AxiosRequestConfig = {
            baseURL: newUrl,
            url: "/api/login",
            method: "POST",
            headers: {
                "X-XSRF-TOKEN": newXsrfToken,
                Cookie: "XSRF-TOKEN=" + newXsrfToken,
            },
            data: {
                username,
                password,
            },
            responseType: "json",
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
        };
        const expectedAxiosResponseXSRF: AxiosResponse<string> = {
            // XSRF Token call
            status: 200,
            statusText: "OK",
            headers: {},
            data: "",
            config: expectedAxiosConfigXSRFRequest,
        };
        expectedAxiosResponseXSRF.headers["set-cookie"] = ["XSRF-TOKEN=" + newXsrfToken + "; Path=/"];
        const expectedAxiosResponseLogin: AxiosResponse<object> = {
            status: 200,
            statusText: "OK",
            headers: {},
            data: {
                jwtToken: newJwtToken,
            },
            config: expectedAxiosConfigLoginRequest,
        };
        mockedAxios
            .mockRejectedValue("Error in test") // default
            .mockResolvedValueOnce(expectedAxiosResponseXSRF)
            .mockResolvedValueOnce(expectedAxiosResponseLogin);
        await APIClient.loginV4T(username, password);

        // Fail if errors are thrown or a promise is rejected (call handleAxiosError)
        expect(mockedVscode.window.showWarningMessage).toHaveBeenCalledTimes(0);
        expect(mockedVscode.window.showErrorMessage).toHaveBeenCalledTimes(0);
        // Set status bar when fetching XSRF
        expect(mockedVscode.window.setStatusBarMessage).toHaveBeenCalledTimes(2);
        expect(mockedVscode.window.setStatusBarMessage).toHaveBeenNthCalledWith(1, "$(sync~spin) Fetching server info...", expect.anything());
        // Set status bar when calling login
        expect(mockedVscode.window.setStatusBarMessage).toHaveBeenNthCalledWith(2, "$(sync~spin) Logging in to VS Code 4 Teaching...", expect.anything());
        // Make a request for XSRF Token
        expect(mockedAxios).toHaveBeenCalledTimes(2);
        expect(mockedAxios).toHaveBeenNthCalledWith(1, expectedAxiosConfigXSRFRequest);
        // Make a request for logging in (fetching JWT Token)
        expect(mockedAxios).toHaveBeenNthCalledWith(2, expectedAxiosConfigLoginRequest);
        // Show user that he is logged in (jwtToken set up)
        expect(mockedVscode.window.showInformationMessage).toHaveBeenCalledTimes(1);
        expect(mockedVscode.window.showInformationMessage).toHaveBeenCalledWith("Logged in");
        // Save session file
        expect(fs.existsSync(APIClientSession.sessionPath)).toBeTruthy();
        const sessionFileText = fs.readFileSync(APIClientSession.sessionPath).toString();
        expect(sessionFileText).toBe(newJwtToken + "\n" + newXsrfToken);
        // Current user logged in should be updated
        expect(mockedCurrentUser.updateUserInfo).toHaveBeenCalled();
        // Tree view should be refreshed
        expect(mockedCoursesTreeProvider.triggerTreeReload).toHaveBeenCalled();
    });

    it("should invalidate session", () => {
        APIClient.invalidateSession();
        expectSessionInvalidated(true);
    });

    it("should handle error 401", () => {
        const error = {
            response: {
                status: 401,
            },
        };
        APIClient.handleAxiosError(error);
        // Warning message showed
        expect(mockedVscode.window.showWarningMessage).toHaveBeenCalledTimes(1);
        expect(mockedVscode.window.showWarningMessage).toHaveBeenCalledWith("It seems that we couldn't log in, please log in.");
        // Refresh tree view
        expect(mockedCoursesTreeProvider.triggerTreeReload).toHaveBeenCalledTimes(1);
        expect(mockedLogger.error).toHaveBeenCalledTimes(1);
        expectSessionInvalidated(true);
    });

    it("should handle error 403", () => {
        const expectedAxiosConfigXSRFRequest: AxiosRequestConfig = {
            baseURL,
            url: "/api/csrf",
            method: "GET",
            headers: {
                Authorization: "Bearer " + jwtToken,
                "X-XSRF-TOKEN": xsrfToken,
                Cookie: "XSRF-TOKEN=" + xsrfToken,
            },
            responseType: "json",
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
        };
        const expectedAxiosResponseXSRF: AxiosResponse<string> = {
            // XSRF Token call
            status: 200,
            statusText: "OK",
            headers: {},
            data: "",
            config: expectedAxiosConfigXSRFRequest,
        };
        expectedAxiosResponseXSRF.headers["set-cookie"] = ["XSRF-TOKEN=29f6caf7-b522-4730-87c4-bfb1b3db0e66; Path=/"];
        mockedAxios
            .mockRejectedValue("Error in test") // default
            .mockResolvedValueOnce(expectedAxiosResponseXSRF);
        const error = {
            response: {
                status: 403,
            },
        };
        APIClient.handleAxiosError(error);
        // Warning message showed
        expect(mockedVscode.window.showWarningMessage).toHaveBeenCalledTimes(1);
        expect(mockedVscode.window.showWarningMessage).toHaveBeenCalledWith("Something went wrong, please try again.");
        // Fetch XSRF Token
        expect(mockedVscode.window.setStatusBarMessage).toHaveBeenCalledTimes(1);
        expect(mockedVscode.window.setStatusBarMessage).toHaveBeenNthCalledWith(1, "$(sync~spin) Fetching server info...", expect.anything());
        expect(mockedAxios).toHaveBeenCalledTimes(1);
        expect(mockedAxios).toHaveBeenNthCalledWith(1, expectedAxiosConfigXSRFRequest);
        expect(mockedLogger.error).toHaveBeenCalledTimes(1);
        expectSessionInvalidated(false);
    });

    it("should handle rest of http errors", () => {
        const dataError = {
            error: "Bad request",
            url: "/api/error",
        };
        const error = {
            response: {
                status: 400,
                data: dataError,
            },
        };
        APIClient.handleAxiosError(error);
        // Error message showed
        expect(mockedVscode.window.showErrorMessage).toHaveBeenCalledTimes(1);
        expect(mockedVscode.window.showErrorMessage).toHaveBeenCalledWith("Error 400. " + JSON.stringify(dataError));
        expectSessionInvalidated(false);
        expect(mockedLogger.error).toHaveBeenCalledTimes(1);
    });

    it("should handle cannot connect to server", () => {
        const error = {
            request: {
                data: "Request error",
            },
            message: "Request error",
        };
        APIClient.handleAxiosError(error);
        // Error message showed
        expect(mockedVscode.window.showErrorMessage).toHaveBeenCalledTimes(1);
        expect(mockedVscode.window.showErrorMessage).toHaveBeenCalledWith("Can't connect to the server. " + error.message);
        expectSessionInvalidated(true);
        expect(mockedLogger.error).toHaveBeenCalledTimes(1);
    });

    it("should handle every error", () => {
        const error = {
            message: "Request error",
        };
        APIClient.handleAxiosError(error);
        // Error message showed
        expect(mockedVscode.window.showErrorMessage).toHaveBeenCalledTimes(1);
        expect(mockedVscode.window.showErrorMessage).toHaveBeenCalledWith(error.message);
        expectSessionInvalidated(false);
        expect(mockedLogger.error).toHaveBeenCalledTimes(1);
    });

    it("should sign up student", async () => {
        const userCredentials: UserSignup = {
            username: "johndoe",
            password: "password",
            email: "johndoe@john.com",
            name: "John",
            lastName: "Doe",
        };
        const newXsrfToken = "29f6caf7-b522-4730-87c4-bfb1b3db0e66";
        const expectedAxiosConfigXSRFRequest: AxiosRequestConfig = {
            baseURL,
            url: "/api/csrf",
            method: "GET",
            headers: {},
            responseType: "json",
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
        };
        const expectedAxiosConfigSignupRequest: AxiosRequestConfig = {
            baseURL,
            url: "/api/register",
            method: "POST",
            headers: {
                "X-XSRF-TOKEN": newXsrfToken,
                Cookie: "XSRF-TOKEN=" + newXsrfToken,
            },
            data: userCredentials,
            responseType: "json",
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
        };
        const expectedAxiosResponseXSRF: AxiosResponse<string> = {
            // XSRF Token call
            status: 200,
            statusText: "OK",
            headers: {},
            data: "",
            config: expectedAxiosConfigXSRFRequest,
        };
        expectedAxiosResponseXSRF.headers["set-cookie"] = ["XSRF-TOKEN=" + newXsrfToken + "; Path=/"];
        const expectedAxiosResponseSignup: AxiosResponse<object> = {
            status: 200,
            statusText: "OK",
            headers: {},
            data: {
                id: 23,
                email: "johndoe@john.com",
                username: "johndoe",
                name: "John",
                lastName: "Doe",
                roles: [
                    {
                        roleName: "ROLE_STUDENT",
                    },
                ],
            },
            config: expectedAxiosConfigSignupRequest,
        };
        mockedAxios
            .mockRejectedValue("Error in test") // default
            .mockResolvedValueOnce(expectedAxiosResponseXSRF)
            .mockResolvedValueOnce(expectedAxiosResponseSignup);
        await APIClient.signUpStudent(userCredentials);

        // Fail if errors are thrown or a promise is rejected (call handleAxiosError)
        expect(mockedVscode.window.showWarningMessage).toHaveBeenCalledTimes(0);
        expect(mockedVscode.window.showErrorMessage).toHaveBeenCalledTimes(0);
        // Set status bar when fetching XSRF
        expect(mockedVscode.window.setStatusBarMessage).toHaveBeenCalledTimes(2);
        expect(mockedVscode.window.setStatusBarMessage).toHaveBeenNthCalledWith(1, "$(sync~spin) Fetching server info...", expect.anything());
        // Set status bar when calling signup
        expect(mockedVscode.window.setStatusBarMessage).toHaveBeenNthCalledWith(2, "$(sync~spin) Signing up to VS Code 4 Teaching...", expect.anything());
        // Make a request for XSRF Token
        expect(mockedAxios).toHaveBeenCalledTimes(2);
        expect(mockedAxios).toHaveBeenNthCalledWith(1, expectedAxiosConfigXSRFRequest);
        // Make a request for signing up
        expect(mockedAxios).toHaveBeenNthCalledWith(2, expectedAxiosConfigSignupRequest);
        // Show user that he is signed up
        expect(mockedVscode.window.showInformationMessage).toHaveBeenCalledTimes(1);
        expect(mockedVscode.window.showInformationMessage).toHaveBeenCalledWith("Signed up. Please log in.");
    });

    it("should generate an invitation for a new teacher", async () => {
        const invitedTeacherCredentials: UserSignup = {
            username: "johndoe",
            email: "johndoe@john.com",
            name: "John",
            lastName: "Doe",
        };
        const expectedAxiosConfigSignupRequest: AxiosRequestConfig = {
            baseURL,
            url: "/api/teachers/invitation",
            method: "POST",
            headers: {
                Authorization: "Bearer " + jwtToken,
                "X-XSRF-TOKEN": xsrfToken,
                Cookie: "XSRF-TOKEN=" + xsrfToken,
            },
            data: invitedTeacherCredentials,
            responseType: "json",
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
        };
        const expectedAxiosResponseSignup: AxiosResponse<any> = {
            status: 201,
            statusText: "",
            headers: {},
            data: {
                email: "johndoe@john.com",
                username: "johndoe",
                name: "John",
                lastName: "Doe",
                password: "bf8a45f8-c20f-4eab-bb13-b02f78cffcb3", // Fake UUID
            },
            config: expectedAxiosConfigSignupRequest,
        };
        mockedAxios
            .mockRejectedValue("Error in test") // default
            .mockResolvedValueOnce(expectedAxiosResponseSignup);
        await APIClient.signUpTeacher(invitedTeacherCredentials);

        // Response is interpreted and link is generated
        const link = baseURL + "/app/teacher/sign-up/" + expectedAxiosResponseSignup.data.password;

        // Fail if errors are thrown or a promise is rejected (call handleAxiosError)
        expect(mockedVscode.window.showWarningMessage).toHaveBeenCalledTimes(0);
        // When testing, promise returned by showInformationError gets rejected (because of a undefined value), so error is caught (handleAxiosError)
        expect(mockedVscode.window.showErrorMessage).toHaveBeenCalledTimes(1);
        // Set status bar when calling signup
        expect(mockedVscode.window.setStatusBarMessage).toHaveBeenNthCalledWith(1, "$(sync~spin) Inviting teacher to VS Code 4 Teaching...", expect.anything());
        // Make a request for signing up
        expect(mockedAxios).toHaveBeenCalledTimes(1);
        expect(mockedAxios).toHaveBeenNthCalledWith(1, expectedAxiosConfigSignupRequest);
        // Show user that he is signed up
        expect(mockedVscode.window.showInformationMessage).toHaveBeenCalledTimes(1);
        expect(mockedVscode.window.showInformationMessage).toHaveBeenCalledWith("The new teacher has been successfully invited! Copy the link and share it with they to finish the process:\n" + link, "Copy link");
    });
});
