// Placeholder test to verify Jest setup
describe('Jest setup', () => {
  it('should work', () => {
    expect(true).toBe(true);
  });

  it('should have browser mock available', () => {
    expect((global as any).browser).toBeDefined();
    expect((global as any).browser.storage).toBeDefined();
  });
});
