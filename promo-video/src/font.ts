import {loadFont} from '@remotion/fonts';
import {staticFile} from 'remotion';

/**
 * 動画で使う和文フォント。プロモも使い方動画も同じ一本を読む。
 * loadFont はバンドル読み込み時に一度だけ走らせたいので、この module に集約する。
 */
export const FONT = 'CourseBoard Gothic, system-ui, sans-serif';

void loadFont({
  family: 'CourseBoard Gothic',
  url: staticFile('fonts/ipag.ttf'),
  format: 'truetype',
  weight: '400',
});
