import './seatMap.scss';
import { Reveal } from '@/components/ui/Animations/Animations';
import { OwnZoneLegendItem, SeatMapScene } from '@/components/scenes/SeatMap/SeatMapScene';

export function SeatMap({ venue, eventName }: { venue: string; eventName: string }) {
    return (
        <Reveal className="seat-map" delay={0.2}>
            <div className="seat-map-header">
                <p className="seat-map-title">
                    Live seating <span className="seat-map-venue">· {venue}</span>
                </p>

                <ul className="seat-map-legend" aria-label="Seat colours">
                    <li>
                        <i className="seat-map-swatch" data-state="available" />
                        Available
                    </li>
                    <li>
                        <i className="seat-map-swatch" data-state="booked" />
                        Booked
                    </li>
                    <OwnZoneLegendItem />
                </ul>
            </div>

            <SeatMapScene eventName={eventName} />
        </Reveal>
    );
}
