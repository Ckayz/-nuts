import { expect, test } from "bun:test";
import { testDatabaseUrlRefusal } from "./setup";

for (const parameter of ["host", "hostaddr", "connectionString", "service", "servicefile"]) {
	test(`refuses destination override ${parameter}`, () => {
		expect(testDatabaseUrlRefusal(`postgresql://u:p@127.0.0.1/x?${parameter}=remote.example`, undefined)).toContain(`"${parameter}"`);
		expect(testDatabaseUrlRefusal(`postgresql://u:p@127.0.0.1/x?${parameter}=`, undefined)).toContain(`"${parameter}"`);
	});
}
test("plain loopback and harmless sslmode remain allowed", () => {
	expect(testDatabaseUrlRefusal("postgresql://u:p@127.0.0.1/x", undefined)).toBeNull();
	expect(testDatabaseUrlRefusal("postgresql://u:p@127.0.0.1/x?sslmode=disable", undefined)).toBeNull();
});
