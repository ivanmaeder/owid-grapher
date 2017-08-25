/* PointsWithLabels.tsx
 * ================
 *
 * Core scatterplot renderer
 *
 * @project Our World In Data
 * @author  Jaiden Mispy
 * @created 2017-03-09
 */

import * as React from 'react'
import * as _ from 'lodash'
import * as d3 from 'd3'
import {observable, computed, action, autorun} from 'mobx'
import {observer} from 'mobx-react'
import Bounds from './Bounds'
import NoData from './NoData'
import AxisScale from './AxisScale'
import {getRelativeMouse, makeSafeForCSS} from './Util'
import Vector2 from './Vector2'
import {Triangle} from './Marks'

export interface ScatterSeries {
    color: string,
    key: string,
    label: string,
    size: number,
    values: ScatterValue[]
};

export interface ScatterValue {
    x: number
    y: number
    size: number
    year: number
    time: {
        x: number,
        y: number
    }
}

interface PointsWithLabelsProps {
    data: ScatterSeries[]
    hoverKeys: string[]
    focusKeys: string[]
    bounds: Bounds
    xScale: AxisScale
    yScale: AxisScale
    sizeDomain: [number, number]
    onSelectEntity: (datakey: string) => void
    onMouseOver: (series: ScatterSeries) => void
    onMouseLeave: () => void
}

interface ScatterRenderValue {
    position: Vector2
    size: number
    fontSize: number
    time: {
        x: number
        y: number
    }
}

interface ScatterRenderSeries {
    key: string
    displayKey: string
    color: string
    size: number
    values: ScatterRenderValue[]
    text: string
    isHover?: boolean
    isFocus?: boolean
    isForeground?: boolean
    offsetVector: Vector2
    startLabel?: ScatterLabel
    midLabels: ScatterLabel[]
    endLabel?: ScatterLabel
    allLabels: ScatterLabel[]
}

interface ScatterLabel {
    text: string
    fontSize: number
    pos: Vector2
    bounds: Bounds
    series: ScatterRenderSeries
    isHidden?: boolean
    isStart?: boolean    
    isMid?: boolean
    isEnd?: boolean
}

@observer
export default class PointsWithLabels extends React.Component<PointsWithLabelsProps> {
    @observable hoverKey: string|null = null

    @computed get focusKeys(): string[] {
        return this.props.focusKeys || []
    }

    @computed get hoverKeys(): string[] {
        return this.props.hoverKeys.concat(this.hoverKey ? [this.hoverKey] : [])
    }

    // Layered mode occurs when any entity on the chart is hovered or focused
    // Then, a special "foreground" set of entities is rendered over the background
    @computed get isLayerMode() {
        return this.focusKeys.length > 0 || this.hoverKeys.length > 0
    }

    @computed get data(): ScatterSeries[] {
        return this.props.data
    }

    @computed get bounds(): Bounds {
        return this.props.bounds
    }

    @computed get xScale(): AxisScale {
        return this.props.xScale.extend({ range: this.bounds.xRange() })
    }

    @computed get yScale(): AxisScale {
        return this.props.yScale.extend({ range: this.bounds.yRange() })
    }

    @computed get isConnected(): boolean {
        return _.some(this.data, series => series.values.length > 1)
    }

    // When focusing multiple entities, we hide some information to declutter
    @computed get isSubtleForeground(): boolean {
        return this.focusKeys.length > 1 && _.some(this.props.data, series => series.values.length > 2)
    }

    @computed get sizeScale() {
        const {data} = this
        const sizeScale = d3.scaleLinear().range([10, 1000]).domain(this.props.sizeDomain)
        return sizeScale
    }

    @computed get fontScale(): Function {
        return d3.scaleLinear().range([10, 13]).domain(this.sizeScale.domain());
    }

    @computed get labelFontFamily(): string {
        return "Arial Narrow, Arial, sans-serif"
    }

    // Used if no color is specified for a series
    @computed get defaultColorScale(): d3.ScaleOrdinal<string, string> {        
        return d3.scaleOrdinal(d3.schemeCategory20)
    }

    // Pre-transform data for rendering
    @computed get initialRenderData(): ScatterRenderSeries[] {
        const {data, xScale, yScale, defaultColorScale, sizeScale, fontScale} = this
        return _.chain(data).map(d => {
            const values = _.map(d.values, v => {
                const area = sizeScale(v.size||1)
                return {
                    position: new Vector2(
                        Math.floor(xScale.place(v.x)),
                        Math.floor(yScale.place(v.y))
                    ),
                    size: Math.sqrt(area/Math.PI),
                    fontSize: fontScale(d.size||1),
                    time: v.time
                }
            })

            return {
                key: d.key,
                displayKey: "key-" + makeSafeForCSS(d.key),
                color: d.color || defaultColorScale(d.key),
                size: (_.last(values) as any).size,
                values: values,
                text: d.label,
                midLabels: [],
                allLabels: [],
                offsetVector: Vector2.zero
            }
        }).sortBy('size').value()
    }

    labelPriority(l: ScatterLabel) {
        let priority = l.fontSize

        if (l.series.isHover)
            priority += 10000
        if (l.series.isFocus)
            priority += 1000
        if (l.isEnd)
            priority += 100

        return priority
    }

    // Create the start year label for a series
    makeStartLabel(series: ScatterRenderSeries): ScatterLabel|undefined {
        // No room to label the year if it's a single point        
        if (!series.isForeground || series.values.length <= 1)
            return undefined

        const {labelFontFamily} = this
        const fontSize = series.isForeground ? (this.isSubtleForeground ? 8 : 9): 7
        const firstValue = series.values[0]
        const nextValue = series.values[1]
        const nextSegment = nextValue.position.subtract(firstValue.position)

        let pos = firstValue.position.subtract(nextSegment.normalize().times(5))
        let bounds = Bounds.forText(firstValue.time.y.toString(), { x: pos.x, y: pos.y, fontSize: fontSize, fontFamily: labelFontFamily })
        if (pos.x < firstValue.position.x)
            bounds = new Bounds(bounds.x-bounds.width+2, bounds.y, bounds.width, bounds.height)
        if (pos.y > firstValue.position.y)
            bounds = new Bounds(bounds.x, bounds.y+bounds.height/2, bounds.width, bounds.height)

        return {
            text: firstValue.time.y.toString(),
            fontSize: fontSize,
            pos: firstValue.position,
            bounds: bounds,
            series: series,
            isStart: true
        }        
    }

    // Make labels for the points between start and end on a series
    // Positioned using normals of the line segments
    makeMidLabels(series: ScatterRenderSeries): ScatterLabel[] {
        if (!series.isForeground || series.values.length <= 1 || (!series.isHover && this.isSubtleForeground))
            return []

        const fontSize = series.isForeground ? (this.isSubtleForeground ? 8 : 9): 7
        const {labelFontFamily} = this
        
        return _.map(series.values.slice(1, -1), (v, i) => {
            const prevPos = i > 0 && series.values[i-1].position
            const prevSegment = prevPos && v.position.subtract(prevPos)
            const nextPos = series.values[i+1].position
            const nextSegment = nextPos.subtract(v.position)

            let pos = v.position
            if (prevPos && prevSegment) {
                const normals = prevSegment.add(nextSegment).normalize().normals().map(x => x.times(5))
                const potentialSpots = _.map(normals, n => v.position.add(n))
                pos = _.sortBy(potentialSpots, p => {
                    return -(Vector2.distance(p, prevPos)+Vector2.distance(p, nextPos))
                })[0]
            } else {
                pos = v.position.subtract(nextSegment.normalize().times(5))
            }

            let bounds = Bounds.forText(v.time.y.toString(), { x: pos.x, y: pos.y, fontSize: fontSize, fontFamily: labelFontFamily })
            if (pos.x < v.position.x)
                bounds = new Bounds(bounds.x-bounds.width+2, bounds.y, bounds.width, bounds.height)
            if (pos.y > v.position.y)
                bounds = new Bounds(bounds.x, bounds.y+bounds.height/2, bounds.width, bounds.height)

            return {
                text: v.time.y.toString(),
                fontSize: fontSize,
                pos: v.position,
                bounds: bounds,
                series: series,
                isMid: true
            }
        })
    }

    // Make the end label (entity label) for a series. Will be pushed
    // slightly out based on the direction of the series if multiple values
    // are present
    makeEndLabel(series: ScatterRenderSeries) {
        const {isSubtleForeground, labelFontFamily} = this

        const lastValue = _.last(series.values) as ScatterRenderValue
        const lastPos = lastValue.position
        const fontSize = lastValue.fontSize*(series.isForeground ? (isSubtleForeground ? 1.2 : 1.3): 1.1)

        let offsetVector = Vector2.up
        if (series.values.length > 1) {
            const prevValue = series.values[series.values.length-2]
            const prevPos = prevValue.position
            offsetVector = lastPos.subtract(prevPos)
        }
        series.offsetVector = offsetVector

        const labelPos = lastPos.add(offsetVector.normalize().times(series.values.length == 1 ? lastValue.size+1 : 5))

        let labelBounds = Bounds.forText(series.text, { x: labelPos.x, y: labelPos.y, fontSize: fontSize, fontFamily: labelFontFamily })
        if (labelPos.x < lastPos.x)
            labelBounds = labelBounds.extend({ x: labelBounds.x-labelBounds.width })
        if (labelPos.y > lastPos.y)
            labelBounds = labelBounds.extend({ y: labelBounds.y+labelBounds.height/2 })            

        return {
            text: series.text,
            fontSize: fontSize,
            bounds: labelBounds,
            series: series,
            pos: labelPos,
            isEnd: true
        }
    }

    @computed get renderData(): ScatterRenderSeries[] {
        let {initialRenderData, hoverKeys, focusKeys, isLayerMode, labelPriority, bounds} = this

        // Draw the largest points first so that smaller ones can sit on top of them
        let renderData = _.cloneDeep(_.sortBy(initialRenderData, d => -d.size))

        _.each(renderData, series => {
            series.isHover = _.includes(hoverKeys, series.key)
            series.isFocus = _.includes(focusKeys, series.key)
            series.isForeground = series.isHover || series.isFocus
            if (series.isHover)
                series.size += 1
        })

        _.each(renderData, series => {
            series.startLabel = this.makeStartLabel(series)
            series.midLabels = this.makeMidLabels(series)
            series.endLabel = this.makeEndLabel(series)
            series.allLabels = _.filter([series.startLabel].concat(series.midLabels).concat([series.endLabel])) as ScatterLabel[]
        })

        const allLabels = _.flatten(_.map(renderData, series => series.allLabels))

        // Ensure labels fit inside bounds
        // Must do before collision detection since it'll change the positions
        _.each(allLabels, l => {
            if (l.bounds.left < bounds.left-1) {
                l.bounds = l.bounds.extend({ x: l.bounds.x+l.bounds.width })
            } else if (l.bounds.right > bounds.right+1) {
                l.bounds = l.bounds.extend({ x: l.bounds.x-l.bounds.width })
            }
            
            if (l.bounds.top < bounds.top-1) {
                l.bounds = l.bounds.extend({ y: bounds.top })
            } else if (l.bounds.bottom > bounds.bottom+1) {
                l.bounds = l.bounds.extend({ y: bounds.bottom-l.bounds.height})
            }
        })

        // Main collision detection
        const labelsByPriority = _.sortBy(allLabels, l => -labelPriority(l))
        for (var i = 0; i < labelsByPriority.length; i++) {
            const l1 = labelsByPriority[i]
            if (l1.isHidden) continue

            for (var j = i+1; j < labelsByPriority.length; j++) {
                const l2 = labelsByPriority[j]
                if (l2.isHidden) continue

                if (l1.bounds.intersects(l2.bounds)) {
                    l2.isHidden = true
                }
            }
        }

        return renderData
    }

    @computed get allColors(): string[] {
        return _.uniq(_.map(this.renderData, 'color'))
    }

    @observable focusKey = null

    base: SVGElement

    @action.bound onMouseLeave() {
        requestAnimationFrame(() => {
            this.hoverKey = null

            if (this.props.onMouseLeave)
                this.props.onMouseLeave()
        })
    }

    @action.bound onMouseMove(ev: any) {
        requestAnimationFrame(() => {
            const mouse = getRelativeMouse(this.base, ev)

            let closestSeries = _.sortBy(this.renderData, (series) => {
                /*if (_.some(series.allLabels, l => !l.isHidden && l.bounds.contains(mouse)))
                    return -Infinity*/

                if (this.isConnected) {
                    return _.min(_.map(series.values.slice(0, -1), (d, i) => {
                        return Vector2.distanceFromPointToLineSq(mouse, d.position, series.values[i+1].position)
                    }))
                } else {
                    return _.min(_.map(series.values, v => Vector2.distanceSq(v.position, mouse)))
                }
            })[0]

            if (closestSeries)
                this.hoverKey = closestSeries.key
            else
                this.hoverKey = null

            if (this.props.onMouseOver) {
                const datum = _.find(this.data, d => d.key == this.hoverKey)
                if (datum)
                    this.props.onMouseOver(datum)
            }
        })
    }

    @action.bound onClick() {
        const {hoverKey, focusKeys} = this
        if (!hoverKey) return

        this.props.onSelectEntity(hoverKey)
    }

    @computed get backgroundGroups(): ScatterRenderSeries[] {
        return _.filter(this.renderData, group => !group.isForeground)
    }

    @computed get foregroundGroups(): ScatterRenderSeries[] {
        return _.filter(this.renderData, group => group.isForeground)
    }

    renderBackgroundLines() {
        const {backgroundGroups, isConnected, isLayerMode} = this

        return _.map(backgroundGroups, series => {
            const firstValue = _.first(series.values) as ScatterRenderValue
            const color = !isLayerMode ? series.color : "#e2e2e2"            

            if (!isConnected) {
                return <circle key={series.displayKey+'-end'} cx={firstValue.position.x} cy={firstValue.position.y} r={firstValue.size} fill={color} opacity={0.8} stroke="#ccc"/>    
            } else if (series.values.length == 1) {
                return null
            } else {
                const lastValue = _.last(series.values) as ScatterRenderValue
                let rotation = Vector2.angle(series.offsetVector, Vector2.up)
                if (series.offsetVector.x < 0) rotation = -rotation

                return <g key={series.displayKey} className={series.displayKey}>
                    <circle 
                        cx={firstValue.position.x} 
                        cy={firstValue.position.y} 
                        r={1+firstValue.size/16} 
                        fill={!isLayerMode ? series.color : "#e2e2e2"} 
                        stroke="#ccc" 
                        opacity={0.6}
                    />
                    <polyline
                        strokeLinecap="round"
                        stroke={isLayerMode ? "#ccc" : series.color}
                        points={_.map(series.values, v => `${v.position.x},${v.position.y}`).join(' ')}
                        fill="none"
                        strokeWidth={0.3+(series.size/16)}
                        opacity={0.6}
                    />
                   <Triangle 
                        transform={`rotate(${rotation}, ${lastValue.position.x}, ${lastValue.position.y})`} 
                        cx={lastValue.position.x} 
                        cy={lastValue.position.y} 
                        r={1+lastValue.size/16} 
                        fill={color} 
                        stroke="#ccc" 
                        strokeWidth={0.2} 
                        opacity={0.6}
                    />                    
                </g>
            }
        })
    }

    renderBackgroundLabels() {
        const {backgroundGroups, isLayerMode, labelFontFamily} = this
        return _.map(backgroundGroups, series => {
            return _.map(series.allLabels, l => 
                !l.isHidden && <text key={series.displayKey+'-endLabel'} 
                  x={l.bounds.x} 
                  y={l.bounds.y+l.bounds.height} 
                  fontSize={l.fontSize} 
                  fontFamily={labelFontFamily}
                  fill={!isLayerMode ? "#666" : "#aaa"}>{l.text}</text>
            )
        })     
    }

    renderForegroundLines() {
        const {foregroundGroups, isSubtleForeground} = this
        
        return _.map(foregroundGroups, series => {
            const lastValue = _.last(series.values) as ScatterRenderValue
            const strokeWidth = (series.isHover ? 3 : (isSubtleForeground ? 0.8 : 2)) + lastValue.size*0.05

            if (series.values.length == 1) {
                const v = series.values[0]
                if (series.isFocus) {
                    return <g key={series.displayKey}>
                        <circle cx={v.position.x} cy={v.position.y} fill="none" stroke={series.color} r={series.size+2}/>
                        <circle cx={v.position.x} cy={v.position.y} fill={series.color} r={series.size}/>
                    </g>
                } else {
                    return <circle key={series.displayKey} cx={v.position.x} cy={v.position.y} fill={series.color} r={series.size}/>
                }
            } else {
                const firstValue = series.values[0]
                return <g key={series.displayKey} className={series.displayKey}>
                    <defs>
                        <marker id={series.displayKey+'-arrow'} fill={series.color} viewBox="0 -5 10 10" refX={5} refY={0} markerWidth={4} markerHeight={4} orient="auto">
                            <path d="M0,-5L10,0L0,5"/>
                        </marker>
                        <marker id={series.displayKey+'-circle'} viewBox="0 0 12 12"
                                refX={4} refY={4} orient="auto" fill={series.color}>
                            <circle cx={4} cy={4} r={4}/>
                        </marker>
                    </defs>
                    {series.isFocus && <circle 
                        cx={firstValue.position.x} 
                        cy={firstValue.position.y} 
                        r={strokeWidth + 1} 
                        fill="none"
                        stroke={series.color} 
                        opacity={0.6}
                    />}
                    <polyline
                        strokeLinecap="round"
                        stroke={series.color}
                        points={_.map(series.values, v => `${v.position.x},${v.position.y}`).join(' ')}
                        fill="none"
                        strokeWidth={strokeWidth}
                        opacity={isSubtleForeground ? 0.6 : 1}
                        markerStart={`url(#${series.displayKey}-circle)`}
                        markerMid={`url(#${series.displayKey}-circle)`}
                        markerEnd={`url(#${series.displayKey}-arrow)`}
                    />
                </g>
            }
        })      
    }

    renderForegroundLabels() {
        const {foregroundGroups, labelFontFamily} = this
        return _.map(foregroundGroups, series => {
            return _.map(series.allLabels, (l, i) =>
                !l.isHidden && <text 
                    key={series.displayKey+'-label-'+i} 
                    x={l.bounds.x} 
                    y={l.bounds.y+l.bounds.height} 
                    fontSize={l.fontSize} 
                    fontFamily={labelFontFamily}
                    fill="#333">{l.text}</text>
            )
        })
    }

    render() {
        //Bounds.debug(_.flatten(_.map(this.renderData, d => _.map(d.labels, 'bounds'))))
        
        const {bounds, renderData, xScale, yScale, sizeScale, allColors} = this
        const clipBounds = bounds.pad(-10)

        if (_.isEmpty(renderData))
            return <NoData bounds={bounds}/>

        return <g className="PointsWithLabels clickable" clipPath="url(#scatterBounds)" onMouseMove={this.onMouseMove} onMouseLeave={this.onMouseLeave} onClick={this.onClick}>
            <rect key="background" x={bounds.x} y={bounds.y} width={bounds.width} height={bounds.height} fill="rgba(255,255,255,0)"/>
            <defs>
                <clipPath id="scatterBounds">
                    <rect x={clipBounds.x} y={clipBounds.y} width={clipBounds.width} height={clipBounds.height}/>
                </clipPath>
            </defs>
            {this.renderBackgroundLines()}
            {this.renderBackgroundLabels()}
            {this.renderForegroundLines()}
            {this.renderForegroundLabels()}
        </g>
    }
}
