// Whichever player the settings chose, or the radio set when the stage showing it is the radio's.
// The stage says which (`radio`), so the two can't disagree while one is handing over to the other.
import { useDeck } from '../../store/deck.js';
import Cassette from './Cassette.jsx';
import Turntable from './Turntable.jsx';
import RadioDevice from './RadioDevice.jsx';

export default function Deck({ radio = false, ...props }) {
  const style = useDeck((s) => s.style);
  if (radio) return <RadioDevice />;
  return style === 'cassette' ? <Cassette {...props} /> : <Turntable {...props} />;
}
