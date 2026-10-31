// Whichever player the settings chose.
import { useDeck } from '../../store/deck.js';
import Cassette from './Cassette.jsx';
import Turntable from './Turntable.jsx';

export default function Deck(props) {
  const style = useDeck((s) => s.style);
  return style === 'cassette' ? <Cassette {...props} /> : <Turntable {...props} />;
}
