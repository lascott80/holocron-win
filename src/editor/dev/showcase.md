# Markdown Showcase

Jump to [[#Tables]] or the [[#^key-fact]]. Some ==highlighted words== and an escaped \*not italic\*.

A fact worth linking to. ^key-fact

%% This comment is hidden unless you edit it. %%
Visible text after an inline %% secret %% comment.

%%
A multi-line comment
that should disappear entirely.
%%

## Tables

| Planet | Climate | Crystals |
| :----- | :-----: | -------: |
| [[Ilum]] | **Frozen** | 12 |
| Dagobah | `swamp` | 0 |
| Lothal | #grassland | 3 |

## Code

```swift
struct Crystal {
    let hue: String // a comment
    func attune() -> Bool { return true }
}
```

```python
def attune(crystal, hue="blue"):
    return f"{crystal} is {hue}"  # done
```

## Footnotes

Crystals sing when attuned.[^song] Ilum is cold.[^cold]

[^song]: Recorded in the archives.
[^cold]: Below −60 °C most nights.

## Callouts that fold

> [!tip]- Hidden by default
> You found the folded content.

> [!warning]+ Open by default
> Click the title to fold me.

<details>
<summary>More details</summary>

Inside the details block.
</details>

## HTML and links

Press <kbd>⌘</kbd> + <kbd>K</kbd>. H<sub>2</sub>O and E = mc<sup>2</sup>. <u>Underlined</u> and <mark>marked</mark>.<br>After a break.

Read the [archive guide][guide] or just [guide].

[guide]: https://example.com/guide "The guide"

## Tasks

- [ ] Open
- [x] Done
- [-] Cancelled
- [/] In progress
- [>] Forwarded
- [!] Important
- [?] Question
- [*] Starred
