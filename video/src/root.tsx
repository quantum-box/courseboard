import {Composition, Still} from 'remotion';
import {CourseBoardPromoRapid, CourseBoardPromoRapidPoster} from './rapid-video';
import {
  DISPATCH_TUTORIAL_FRAMES,
  DispatchTutorial,
  DispatchTutorialPoster,
} from './dispatch-tutorial';
import {
  RECEPTION_TUTORIAL_FRAMES,
  ReceptionTutorial,
  ReceptionTutorialPoster,
} from './reception-tutorial';

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
    <Composition
      id="ReceptionTutorial"
      component={ReceptionTutorial}
      durationInFrames={RECEPTION_TUTORIAL_FRAMES}
      fps={30}
      width={1920}
      height={1080}
    />
    <Still
      id="ReceptionTutorialPoster"
      component={ReceptionTutorialPoster}
      width={1920}
      height={1080}
    />
    <Composition
      id="DispatchTutorial"
      component={DispatchTutorial}
      durationInFrames={DISPATCH_TUTORIAL_FRAMES}
      fps={30}
      width={1920}
      height={1080}
    />
    <Still
      id="DispatchTutorialPoster"
      component={DispatchTutorialPoster}
      width={1920}
      height={1080}
    />
  </>
);
