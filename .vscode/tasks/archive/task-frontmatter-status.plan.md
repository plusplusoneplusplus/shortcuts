---
status: done
---

# Task: Add Front Matter with Status to Task Documents

---
status: todo
---

## Description

When creating a new task document, automatically include YAML front matter that displays the current status of the task. This provides a standardized way to track task progress directly within the document metadata.

## Acceptance Criteria

- [ ] New task documents include YAML front matter block at the top
- [ ] Front matter contains a `status` field with default value
- [ ] Status field supports standard values: `todo`, `in-progress`, `review`, `done`
- [ ] Front matter is properly formatted with `---` delimiters
- [ ] Existing task creation workflows are updated to include front matter

## Subtasks

- [ ] Define the front matter schema and supported status values
- [ ] Update task template to include front matter block
- [ ] Modify task creation logic to inject front matter
- [ ] Add validation for status field values
- [ ] Update documentation with front matter usage examples

## Notes

- Front matter follows standard YAML syntax used by static site generators and markdown processors
- Consider adding additional metadata fields in the future (priority, assignee, due date)
- Status changes should be easily editable by users directly in the document
