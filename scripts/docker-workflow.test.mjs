import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const workflowDir = fileURLToPath(new URL("../.github/workflows/", import.meta.url));
const release = readFileSync(path.join(workflowDir, "release.yml"), "utf8");
const ci = readFileSync(path.join(workflowDir, "ci.yml"), "utf8");

test("release workflow can push the server image to ghcr.io", () => {
    assert.match(release, /^permissions:\n(?:  .*\n)*  packages: write$/m);
    assert.match(release, /^  build-docker:\n    needs: \[[^\]]*\bdependency-security\b[^\]]*\]$/m);
    assert.match(release, /uses: docker\/login-action@v\d+\n\s+with:\n\s+registry: ghcr\.io/);
    assert.match(release, /images: \$\{\{ steps\.image\.outputs\.name \}\}/);
    assert.match(release, /echo "name=ghcr\.io\/\$\{OWNER\}\/coc" >> "\$GITHUB_OUTPUT"/);
});

test("release image is multi-arch, tagged by semver, and `latest` only for stable tags", () => {
    assert.match(release, /platforms: linux\/amd64,linux\/arm64/);
    assert.match(release, /type=semver,pattern=\{\{version\}\},value=\$\{\{ github\.event\.inputs\.tag \|\| github\.ref_name \}\}/);
    assert.match(release, /type=semver,pattern=\{\{major\}\}\.\{\{minor\}\},value=\$\{\{ github\.event\.inputs\.tag \|\| github\.ref_name \}\}/);
    assert.match(release, /type=raw,value=latest,enable=\$\{\{ !contains\(github\.event\.inputs\.tag \|\| github\.ref_name, '-'\) \}\}/);
    assert.match(release, /BUILD_COMMIT=\$\{\{ github\.sha \}\}/);
});

test("a docker failure does not block the desktop release and vice versa", () => {
    assert.match(release, /^  create-release:\n    needs: \[build-mac, build-win\]$/m);
    assert.doesNotMatch(release, /needs: \[[^\]]*build-docker[^\]]*\]/);
    // The other direction. build-docker may share an upstream with the
    // installers — build-native produces the binaries both of them stage — but
    // it must never queue behind the installers themselves.
    const dockerNeeds = /^  build-docker:\n    needs: (.+)$/m.exec(release);
    assert.ok(dockerNeeds, "build-docker has no needs: line");
    assert.doesNotMatch(dockerNeeds[1], /build-mac|build-win/);
});

test("release notes tell users to run the image with host networking, not -p", () => {
    assert.match(release, /docker run --network host -v coc-data:\/data ghcr\.io\/\$\{OWNER\}\/coc:\$\{VERSION\}/);
    assert.match(release, /OWNER: \$\{\{ github\.repository_owner \}\}[\s\S]*gh release create/);
});

test("ci builds the image (no push) and smoke-tests health, loopback-only bind, drain, sidecar path, CLI", () => {
    assert.match(ci, /^  docker-build-smoke:$/m);
    const job = ci.slice(ci.indexOf("  docker-build-smoke:"), ci.indexOf("\n  ci:\n"));
    assert.match(job, /uses: docker\/build-push-action@v\d+\n\s+with:\n\s+context: \.\n\s+load: true/);
    assert.doesNotMatch(job, /push: true/);
    assert.match(job, /docker run -d --name coc --network host coc:ci --host 127\.0\.0\.1 --port 4111/);
    assert.match(job, /curl -sf http:\/\/127\.0\.0\.1:4111\/api\/health/);
    assert.match(job, /grep -qi " 0100007F:100F " \/proc\/net\/tcp/);
    assert.match(job, /docker stop -t \d+ coc\n[\s\S]*ExitCode/);
    assert.match(job, /docker run --rm --network container:coc2 curlimages\/curl/);
    assert.match(job, /docker run --rm --entrypoint coc coc:ci --version/);
});

test("docker-build-smoke is a required job in the ci gate", () => {
    assert.match(ci, /^    needs: \[[^\]]*\bdocker-build-smoke\b[^\]]*\]$/m);
    assert.match(ci, /\[docker-build-smoke\]="\$\{\{ needs\.docker-build-smoke\.result \}\}"/);
});

test("docker/* actions are pinned to the same major across workflows", () => {
    const majorsByAction = new Map();
    for (const file of readdirSync(workflowDir).filter((name) => /\.ya?ml$/.test(name))) {
        const content = readFileSync(path.join(workflowDir, file), "utf8");
        for (const match of content.matchAll(/uses:\s*(docker\/[\w-]+)@v(\d+)/g)) {
            const [, action, major] = match;
            const seen = majorsByAction.get(action);
            if (seen === undefined) {
                majorsByAction.set(action, { major, file });
                continue;
            }
            assert.equal(major, seen.major, `${action} is pinned to v${seen.major} in ${seen.file} but v${major} in ${file}`);
        }
    }
    assert.ok(majorsByAction.has("docker/build-push-action"));
});
