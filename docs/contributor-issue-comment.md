# _Contributor issue comment_ workflow overview

| Contributor type | Issue type | Comment type | #support-dev | #support-dev-notifications | GitHub bot | GitHub bot message |
|------------------|------------|--------------|--------------|---------------------------|------------------|-------------|
| **Core team** | Any | Any | No | No | No | - |
| **Close contributor** | Any | Any | **Yes** | No | No | - |
| **Issue creator** | `help-wanted` | Any | **Yes** | No | No | - |
| **Issue creator** | Private | Any | No | Yes | No | - |
| **Other** | Private | Regular | No | Yes | No | - |
| **Other** | Private | Assignment request | No | Yes | Yes`*` | `BOT_MESSAGE_ISSUE_NOT_OPEN` |
| **Other** | `help-wanted` | Regular | **Yes** | No | No | - |
| **Other** | Unassigned `help-wanted` | Assignment request | **Yes** | No | No | - |
| **Other** | `help-wanted` assigned to someone else | Assignment request | No | Yes | Yes`*` | `BOT_MESSAGE_ALREADY_ASSIGNED` |

`*` There is an additional optimization that prevents more than one bot message per hour to not overwhelm issue comment section
