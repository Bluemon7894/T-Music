// Whichever player the settings chose, or the radio set while the radio is on.
import { useDeck } from '../../store/deck.js';
import { useRadio } from '../../store/radio.js';
import Cassette from './Cassette.jsx';
import Turntable from './Turntable.jsx';
import RadioDevice from './RadioDevice.jsx';

export default function Deck(props) {
  const style = useDeck((s) => s.style);
  const radio = useRadio((s) => s.on);
  if (radio) return <RadioDevice />;
  return style === 'cassette' ? <Cassette {...props} /> : <Turntable {...props} />;
}
