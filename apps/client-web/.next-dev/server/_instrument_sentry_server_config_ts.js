"use strict";
/*
 * ATTENTION: An "eval-source-map" devtool has been used.
 * This devtool is neither made for production nor for readable output files.
 * It uses "eval()" calls to create a separate source file with attached SourceMaps in the browser devtools.
 * If you are trying to read the output file, select a different devtool (https://webpack.js.org/configuration/devtool/)
 * or disable the default devtool with "devtool: false".
 * If you are looking for production-ready output files, see mode: "production" (https://webpack.js.org/configuration/mode/).
 */
exports.id = "_instrument_sentry_server_config_ts";
exports.ids = ["_instrument_sentry_server_config_ts"];
exports.modules = {

/***/ "(instrument)/./sentry.server.config.ts":
/*!*********************************!*\
  !*** ./sentry.server.config.ts ***!
  \*********************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

eval("__webpack_require__.r(__webpack_exports__);\n/* harmony import */ var _sentry_nextjs__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! @sentry/nextjs */ \"(instrument)/../../node_modules/@sentry/nextjs/build/cjs/index.server.js\");\n/* harmony import */ var _sentry_nextjs__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(_sentry_nextjs__WEBPACK_IMPORTED_MODULE_1__);\n/* harmony import */ var _sentry_shared__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./sentry.shared */ \"(instrument)/./sentry.shared.ts\");\n\n\n_sentry_nextjs__WEBPACK_IMPORTED_MODULE_1__.init((0,_sentry_shared__WEBPACK_IMPORTED_MODULE_0__.getServerSentryOptions)('nodejs'));\n//# sourceURL=[module]\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiKGluc3RydW1lbnQpLy4vc2VudHJ5LnNlcnZlci5jb25maWcudHMiLCJtYXBwaW5ncyI6Ijs7OztBQUF5QztBQUNnQjtBQUV6REEsZ0RBQVcsQ0FBQ0Msc0VBQXNCQSxDQUFDIiwic291cmNlcyI6WyIvVXNlcnMva3lsZW1hbnRlc3NvL0RvY3VtZW50cy9kZXYvY291bnNlbC1pcS9hcHBzL2NsaWVudC13ZWIvc2VudHJ5LnNlcnZlci5jb25maWcudHMiXSwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgU2VudHJ5IGZyb20gJ0BzZW50cnkvbmV4dGpzJztcbmltcG9ydCB7IGdldFNlcnZlclNlbnRyeU9wdGlvbnMgfSBmcm9tICcuL3NlbnRyeS5zaGFyZWQnO1xuXG5TZW50cnkuaW5pdChnZXRTZXJ2ZXJTZW50cnlPcHRpb25zKCdub2RlanMnKSk7XG4iXSwibmFtZXMiOlsiU2VudHJ5IiwiZ2V0U2VydmVyU2VudHJ5T3B0aW9ucyIsImluaXQiXSwiaWdub3JlTGlzdCI6W10sInNvdXJjZVJvb3QiOiIifQ==\n//# sourceURL=webpack-internal:///(instrument)/./sentry.server.config.ts\n");

/***/ }),

/***/ "(instrument)/./sentry.shared.ts":
/*!**************************!*\
  !*** ./sentry.shared.ts ***!
  \**************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

eval("__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   getSentryDsn: () => (/* binding */ getSentryDsn),\n/* harmony export */   getServerSentryOptions: () => (/* binding */ getServerSentryOptions)\n/* harmony export */ });\nfunction getSentryDsn() {\n    return process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;\n}\nfunction getServerSentryOptions(runtime) {\n    const isDev = \"development\" === 'development';\n    const dsn = getSentryDsn();\n    const appVersion = \"0.1.0\" ?? 0;\n    return {\n        dsn,\n        enabled: Boolean(dsn),\n        environment: \"development\",\n        release: `counseliq-web@${appVersion}`,\n        sendDefaultPii: true,\n        tracesSampleRate: isDev ? 1.0 : 0.1,\n        enableLogs: true,\n        initialScope: {\n            tags: {\n                surface: 'web',\n                runtime\n            }\n        }\n    };\n}\n//# sourceURL=[module]\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiKGluc3RydW1lbnQpLy4vc2VudHJ5LnNoYXJlZC50cyIsIm1hcHBpbmdzIjoiOzs7OztBQUVPLFNBQVNBO0lBQ2QsT0FBT0MsUUFBUUMsR0FBRyxDQUFDQyxVQUFVLElBQUlGLFFBQVFDLEdBQUcsQ0FBQ0Usc0JBQXNCO0FBQ3JFO0FBRU8sU0FBU0MsdUJBQ2RDLE9BQTBCO0lBRTFCLE1BQU1DLFFBQVFOLGtCQUF5QjtJQUN2QyxNQUFNTyxNQUFNUjtJQUNaLE1BQU1TLGFBQWFSLE9BQW1DLElBQUksQ0FBUztJQUVuRSxPQUFPO1FBQ0xPO1FBQ0FHLFNBQVNDLFFBQVFKO1FBQ2pCSyxhQUlGO1FBSEVDLFNBQVMsQ0FBQyxjQUFjLEVBQUVMLFlBQVk7UUFDdENNLGdCQUFnQjtRQUNoQkMsa0JBQWtCVCxRQUFRLE1BQU07UUFDaENVLFlBQVk7UUFDWkMsY0FBYztZQUNaQyxNQUFNO2dCQUNKQyxTQUFTO2dCQUNUZDtZQUNGO1FBQ0Y7SUFDRjtBQUNGIiwic291cmNlcyI6WyIvVXNlcnMva3lsZW1hbnRlc3NvL0RvY3VtZW50cy9kZXYvY291bnNlbC1pcS9hcHBzL2NsaWVudC13ZWIvc2VudHJ5LnNoYXJlZC50cyJdLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBTZW50cnkgZnJvbSAnQHNlbnRyeS9uZXh0anMnO1xuXG5leHBvcnQgZnVuY3Rpb24gZ2V0U2VudHJ5RHNuKCk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gIHJldHVybiBwcm9jZXNzLmVudi5TRU5UUllfRFNOID8/IHByb2Nlc3MuZW52Lk5FWFRfUFVCTElDX1NFTlRSWV9EU047XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBnZXRTZXJ2ZXJTZW50cnlPcHRpb25zKFxuICBydW50aW1lOiAnbm9kZWpzJyB8ICdlZGdlJyxcbik6IFNlbnRyeS5Ob2RlT3B0aW9ucyB7XG4gIGNvbnN0IGlzRGV2ID0gcHJvY2Vzcy5lbnYuTk9ERV9FTlYgPT09ICdkZXZlbG9wbWVudCc7XG4gIGNvbnN0IGRzbiA9IGdldFNlbnRyeURzbigpO1xuICBjb25zdCBhcHBWZXJzaW9uID0gcHJvY2Vzcy5lbnYuTkVYVF9QVUJMSUNfQVBQX1ZFUlNJT04gPz8gJ3Vua25vd24nO1xuXG4gIHJldHVybiB7XG4gICAgZHNuLFxuICAgIGVuYWJsZWQ6IEJvb2xlYW4oZHNuKSxcbiAgICBlbnZpcm9ubWVudDogcHJvY2Vzcy5lbnYuTk9ERV9FTlYsXG4gICAgcmVsZWFzZTogYGNvdW5zZWxpcS13ZWJAJHthcHBWZXJzaW9ufWAsXG4gICAgc2VuZERlZmF1bHRQaWk6IHRydWUsXG4gICAgdHJhY2VzU2FtcGxlUmF0ZTogaXNEZXYgPyAxLjAgOiAwLjEsXG4gICAgZW5hYmxlTG9nczogdHJ1ZSxcbiAgICBpbml0aWFsU2NvcGU6IHtcbiAgICAgIHRhZ3M6IHtcbiAgICAgICAgc3VyZmFjZTogJ3dlYicsXG4gICAgICAgIHJ1bnRpbWUsXG4gICAgICB9LFxuICAgIH0sXG4gIH07XG59XG4iXSwibmFtZXMiOlsiZ2V0U2VudHJ5RHNuIiwicHJvY2VzcyIsImVudiIsIlNFTlRSWV9EU04iLCJORVhUX1BVQkxJQ19TRU5UUllfRFNOIiwiZ2V0U2VydmVyU2VudHJ5T3B0aW9ucyIsInJ1bnRpbWUiLCJpc0RldiIsImRzbiIsImFwcFZlcnNpb24iLCJORVhUX1BVQkxJQ19BUFBfVkVSU0lPTiIsImVuYWJsZWQiLCJCb29sZWFuIiwiZW52aXJvbm1lbnQiLCJyZWxlYXNlIiwic2VuZERlZmF1bHRQaWkiLCJ0cmFjZXNTYW1wbGVSYXRlIiwiZW5hYmxlTG9ncyIsImluaXRpYWxTY29wZSIsInRhZ3MiLCJzdXJmYWNlIl0sImlnbm9yZUxpc3QiOltdLCJzb3VyY2VSb290IjoiIn0=\n//# sourceURL=webpack-internal:///(instrument)/./sentry.shared.ts\n");

/***/ })

};
;