// workspace: @ndea/sdk
// virtual-path: src/forbidden-react-import.ts
// expect-error: @ndea/sdk cannot import React runtime module react

import { createElement } from "react";

export const forbiddenReactImport = createElement;
