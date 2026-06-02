import assert from "node:assert/strict";
import test from "node:test";

import { ensureNativeDependencies, ensureNativeDependency } from "./ensure-native-dependency.mjs";

const silentLogger = {
    error() {},
    log() {},
    warn() {},
};

test("does not rebuild when the package loads", () => {
    let rebuilds = 0;

    const result = ensureNativeDependency("native-package", {
        loadPackage() {},
        rebuildPackage() {
            rebuilds += 1;
            return { status: 0 };
        },
        logger: silentLogger,
    });

    assert.deepEqual(result, { ok: true, rebuilt: false });
    assert.equal(rebuilds, 0);
});

test("rebuilds once when the first load fails", () => {
    let loads = 0;
    let rebuilds = 0;

    const result = ensureNativeDependency("native-package", {
        loadPackage() {
            loads += 1;
            if (loads === 1) {
                throw new Error("missing binding");
            }
        },
        rebuildPackage(packageName) {
            rebuilds += 1;
            assert.equal(packageName, "native-package");
            return { status: 0 };
        },
        logger: silentLogger,
    });

    assert.deepEqual(result, { ok: true, rebuilt: true });
    assert.equal(loads, 2);
    assert.equal(rebuilds, 1);
});

test("fails when rebuild exits non-zero", () => {
    const result = ensureNativeDependency("native-package", {
        loadPackage() {
            throw new Error("missing binding");
        },
        rebuildPackage() {
            return { status: 1 };
        },
        logger: silentLogger,
    });

    assert.deepEqual(result, { ok: false, rebuilt: true });
});

test("fails when the package still cannot load after rebuild", () => {
    const result = ensureNativeDependency("native-package", {
        loadPackage() {
            throw new Error("still missing");
        },
        rebuildPackage() {
            return { status: 0 };
        },
        logger: silentLogger,
    });

    assert.deepEqual(result, { ok: false, rebuilt: true });
});

test("checks every requested dependency", () => {
    const checked = [];

    const result = ensureNativeDependencies(["first-native-package", "second-native-package"], {
        loadPackage(packageName) {
            checked.push(packageName);
        },
        rebuildPackage() {
            throw new Error("unexpected rebuild");
        },
        logger: silentLogger,
    });

    assert.equal(result.ok, true);
    assert.deepEqual(checked, ["first-native-package", "second-native-package"]);
    assert.deepEqual(
        result.results.map(({ packageName, ok, rebuilt }) => ({ packageName, ok, rebuilt })),
        [
            { packageName: "first-native-package", ok: true, rebuilt: false },
            { packageName: "second-native-package", ok: true, rebuilt: false },
        ],
    );
});
