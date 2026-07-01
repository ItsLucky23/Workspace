const BREAKPOINT_PREFIXES = ['sm', 'md', 'lg', 'xl', '2xl'];

export function transformBreakpointsToContainer(code: string): string {
  //? replace any sm:, md:, lg:, xl:, 2xl: with @sm:, @md:, @lg:, @xl:, @2xl:
  const pattern = new RegExp(
    `(?<=[\\s"'\`])(?<!@)(${BREAKPOINT_PREFIXES.join('|')}):`,
    'g'
  );

  return code.replace(pattern, '@$1:');
}
