# Fix GitHub Workflow Failures

Loop until all test failures in the GitHub workflow are fixed for the current commit.

## Steps to Execute

### 1. Get Current Commit SHA
```bash
git rev-parse HEAD
```

### 2. List Recent Workflow Runs for This Commit
```bash
gh run list --commit $(git rev-parse HEAD) --limit 10
```

### 3. Check for Failed Runs
- If no runs found, wait and re-check (workflow may still be queued)
- If all runs are successful, report success and exit
- If any runs are in progress, wait for completion before analyzing

### 4. For Each Failed Run
```bash
# Get the run ID of failed runs
gh run list --commit $(git rev-parse HEAD) --status failure --json databaseId,name,conclusion

# View the failed run logs
gh run view <run_id> --log-failed
```

### 5. Analyze Failure Logs
- Parse the error messages from the logs
- Identify the root cause (test failures, build errors, lint issues, etc.)
- Determine which files need to be modified

### 6. Fix the Issues
- Make the necessary code changes to fix the failures
- Run local tests if applicable to verify fixes:
  ```bash
  npm run test
  npm run lint
  npm run compile
  ```

### 7. Commit and Push Fixes
```bash
git add -A
git commit -m "fix: resolve workflow failures"
git push
```

### 8. Wait for New Workflow Run
```bash
# Wait a few seconds for the new run to start
sleep 10

# Check the new run status
gh run list --commit $(git rev-parse HEAD) --limit 5
```

### 9. Loop Until Success
- Go back to Step 2 and repeat
- Continue until all workflow runs pass
- Report final success when all checks are green

## Tips
- Use `gh run watch <run_id>` to watch a specific run in real-time
- Use `gh run rerun <run_id>` to rerun a failed workflow without pushing new code (for flaky tests)
- Check if failures are due to flaky tests before making code changes

## Exit Conditions
- **Success**: All workflow runs for the HEAD commit show "completed" with "success" conclusion
- **Manual Intervention Needed**: If the same failure persists after 3 fix attempts, ask the user for guidance
