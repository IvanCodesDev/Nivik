import { cookies } from 'next/headers';
import { parseTheme, THEME_COOKIE, type Theme } from './themes';

/** Theme for the current request: the saved setting mirrored in the `nivik.theme` cookie. */
export async function getRequestTheme(): Promise<Theme> {
  const cookieStore = await cookies();
  return parseTheme(cookieStore.get(THEME_COOKIE)?.value);
}
