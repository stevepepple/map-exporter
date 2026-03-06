import { IControl, Map as MapboxMap } from 'mapbox-gl';
import { SizeType, DPIType, FormatType, MaplibreExportControl, UnitType } from '@watergis/maplibre-gl-export';
import { ControlOptions } from './interfaces';
export default class MapboxExportControl extends MaplibreExportControl implements IControl {
    private accessToken;
    constructor(options: ControlOptions);
    protected generateMap(map: MapboxMap, size: SizeType, dpi: DPIType, format: FormatType, unit: UnitType, filename?: string): void;
}
//# sourceMappingURL=export-control.d.ts.map