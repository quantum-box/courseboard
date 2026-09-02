import {Composition, Still} from 'remotion';
import {CourseBoardPromoRapid, CourseBoardPromoRapidPoster} from './rapid-video';

export const RemotionRoot = () => (
  <>
    <Composition
      id="CourseBoardPromo"
      component={CourseBoardPromoRapid}
      durationInFrames={900}
      fps={30}
      width={1920}
      height={1080}
    />
    <Still
      id="CourseBoardPromoPoster"
      component={CourseBoardPromoRapidPoster}
      width={1920}
      height={1080}
    />
  </>
);
