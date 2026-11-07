import { describe, expect, it } from "vitest";
import {
  portOfUrl,
  previewPortFor,
  remoteServerCommand,
  webProjectDocroot,
} from "./remoteServer";
import type { WebProjectEntry } from "./webProject";

const file = (name: string): WebProjectEntry => ({ name, kind: "file" });
const dir = (name: string): WebProjectEntry => ({ name, kind: "dir" });

describe("previewPortFor", () => {
  it("is stable and stays in the unprivileged preview range", () => {
    const port = previewPortFor("/srv/www/site");
    expect(previewPortFor("/srv/www/site")).toBe(port);
    expect(port).toBeGreaterThanOrEqual(8100);
    expect(port).toBeLessThan(8900);
  });

  it("spreads different projects over different ports", () => {
    const ports = new Set(
      ["/a", "/b", "/c", "/srv/one", "/srv/two", "/home/u/blog"].map(
        previewPortFor,
      ),
    );
    expect(ports.size).toBeGreaterThan(3);
  });
});

describe("webProjectDocroot", () => {
  it("uses public when the entry point lives there", () => {
    expect(webProjectDocroot([dir("public"), file("composer.json")])).toBe("public");
  });
  it("uses the folder when it has its own index", () => {
    expect(webProjectDocroot([dir("public"), file("index.php")])).toBe(".");
    expect(webProjectDocroot([file("index.html")])).toBe(".");
  });
});

describe("remoteServerCommand", () => {
  it("serves Laravel with artisan", () => {
    expect(remoteServerCommand("laravel", 8123, "public")).toBe(
      "php artisan serve --host=127.0.0.1 --port=8123",
    );
  });
  it("serves PHP, WordPress and static folders with the built-in server", () => {
    expect(remoteServerCommand("wordpress", 8123, ".")).toBe(
      "php -S 127.0.0.1:8123 -t .",
    );
    expect(remoteServerCommand("php", 8124, "public")).toBe(
      "php -S 127.0.0.1:8124 -t public",
    );
  });
  it("binds to loopback only and rejects bad ports", () => {
    expect(remoteServerCommand("php", 8123, ".")).toContain("127.0.0.1");
    expect(() => remoteServerCommand("php", 80, ".")).toThrow(RangeError);
    expect(() => remoteServerCommand("php", 8123.5, ".")).toThrow(RangeError);
  });
});

describe("portOfUrl", () => {
  it("reads the port of a captured origin", () => {
    expect(portOfUrl("http://127.0.0.1:8123")).toBe(8123);
    expect(portOfUrl("http://localhost")).toBeNull();
    expect(portOfUrl("nope")).toBeNull();
  });
});
