// Command-line arguments from the jump list, sign-in and file associations (src/main/launchArgs.ts).

import { describe, expect, it } from "vitest";
import { hasActions, noLaunchArgs, notePath, parseLaunchArgs } from "../../src/main/launchArgs";
import { buildJumpList, applyJumpList, type JumpListHost } from "../../src/main/jumpList";

const exe = "C:\\Program Files\\Holocron\\Holocron.exe";

describe("parseLaunchArgs", () => {
  it("nothing to do", () => {
    expect(parseLaunchArgs([exe])).toEqual(noLaunchArgs);
    expect(parseLaunchArgs([])).toEqual(noLaunchArgs);
    expect(hasActions(parseLaunchArgs([exe, "--hidden"]))).toBe(false);
  });

  it("reads the flags anywhere, case-insensitively", () => {
    expect(parseLaunchArgs([exe, "--allow-file-access-from-files", "--TODAY"])).toMatchObject({ today: true, newNote: false });
    expect(parseLaunchArgs([exe, "--new-note"]).newNote).toBe(true);
    expect(parseLaunchArgs([exe, "--capture", "--hidden"])).toMatchObject({ capture: true, hidden: true });
  });

  it("skips the program and, in development, the app folder", () => {
    expect(parseLaunchArgs(["electron.exe", "C:\\dev\\holocron\\out\\main\\index.js", "--today"])).toMatchObject({ today: true, open: null });
    // The program itself is never taken as a note, whatever it's called.
    expect(parseLaunchArgs(["C:\\notes\\weird.md"]).open).toBeNull();
  });

  it("--open with a path, as one or two arguments", () => {
    expect(parseLaunchArgs([exe, "--open", "C:\\Vault\\Note.md"]).open).toBe("C:\\Vault\\Note.md");
    expect(parseLaunchArgs([exe, "--open=C:\\Vault\\My Note.md"]).open).toBe("C:\\Vault\\My Note.md");
    expect(parseLaunchArgs([exe, '--open="C:\\Vault\\Quoted.md"']).open).toBe("C:\\Vault\\Quoted.md");
    expect(parseLaunchArgs([exe, "--open=C:/Vault/sub/../Note.MARKDOWN"]).open).toBe("C:\\Vault\\Note.MARKDOWN");
  });

  it("a bare note path (file association)", () => {
    expect(parseLaunchArgs([exe, "D:\\Notes\\Kyber.md"]).open).toBe("D:\\Notes\\Kyber.md");
    expect(parseLaunchArgs([exe, "\\\\server\\share\\Kyber.md"]).open).toBe("\\\\server\\share\\Kyber.md");
  });

  it("ignores paths that aren't absolute notes", () => {
    for (const bad of ["Note.md", "..\\Note.md", "C:Note.md", "C:\\Vault\\run.exe", "C:\\Vault\\Note.md.lnk", "\\\\?\\C:\\Vault\\Note.md", "\\\\.\\pipe\\x.md", "\\Vault\\Note.md", "C:\\Vault\\a\0.md"]) {
      expect(notePath(bad)).toBeNull();
      expect(parseLaunchArgs([exe, "--open", bad]).open).toBeNull();
    }
  });

  it("--open without a value doesn't swallow the next flag", () => {
    expect(parseLaunchArgs([exe, "--open", "--today"])).toMatchObject({ open: null, today: true });
  });
});

describe("Jump list", () => {
  const notes = Array.from({ length: 10 }, (_, i) => ({ title: `Note ${i}`, file: `C:\\Vault\\Note ${i}.md`, vaultPath: `Note ${i}.md` }));

  it("tasks launch Holocron with an argument; recent notes are a custom category", () => {
    const categories = buildJumpList(exe, notes);
    expect(categories.map((category) => category.type)).toEqual(["custom", "tasks"]);
    const [recent, tasks] = categories;
    expect(recent.name).toBe("Recent Notes");
    expect(recent.items).toHaveLength(8);
    expect(recent.items![0]).toEqual({
      type: "task",
      title: "Note 0",
      description: "Note 0.md",
      program: exe,
      args: '--open="C:\\Vault\\Note 0.md"',
      iconPath: exe,
      iconIndex: 0,
    });
    expect(tasks.items!.map((item) => [item.title, item.args])).toEqual([
      ["New Note", "--new-note"],
      ["Today’s Note", "--today"],
      ["Quick Capture", "--capture"],
    ]);
    // Every item's arguments come back as what it means.
    expect(parseLaunchArgs([exe, recent.items![3].args!]).open).toBe("C:\\Vault\\Note 3.md");
  });

  it("no vault, no recent notes category", () => {
    expect(buildJumpList(exe, []).map((category) => category.type)).toEqual(["tasks"]);
  });

  it("leaves out items the user removed", () => {
    const removed = [{ type: "task" as const, args: '--open="C:\\Vault\\Note 0.md"' }];
    const [recent] = buildJumpList(exe, notes, removed);
    expect(recent.items!.map((item) => item.title)).toEqual(["Note 1", "Note 2", "Note 3", "Note 4", "Note 5", "Note 6", "Note 7", "Note 8"]);
  });

  it("retries without the custom category when Windows refuses it, and never throws", () => {
    const calls: unknown[] = [];
    const host: JumpListHost = {
      setJumpList: (categories) => {
        calls.push(categories);
        return calls.length === 1 ? "customCategoryAccessDeniedError" : "ok";
      },
      getJumpListSettings: () => ({ minItems: 10, removedItems: [] }),
    };
    expect(applyJumpList(host, exe, notes)).toBe("ok");
    expect((calls[1] as { type: string }[]).map((category) => category.type)).toEqual(["tasks"]);

    const broken: JumpListHost = {
      setJumpList: () => {
        throw new Error("boom");
      },
      getJumpListSettings: () => {
        throw new Error("boom");
      },
    };
    expect(applyJumpList(broken, exe, notes)).toBe("error");
  });
});
