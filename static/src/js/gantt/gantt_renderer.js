/** @odoo-module **/

import {_lt} from "@web/core/l10n/translation";
import {getBorderWhite, DEFAULT_BG, getColor, hexToRGBA} from "./colors";
import {formatFloat} from "@web/views/fields/formatters";
import {SEP} from "./gantt_model";
import {sortBy} from "@web/core/utils/arrays";
import {loadJS} from "@web/core/assets";
import {renderToString} from "@web/core/utils/render";
import {useService} from "@web/core/utils/hooks";

import {Component, onWillUnmount, useEffect, useRef, onWillStart} from "@odoo/owl";

const NO_DATA = _lt("No data");

export const LINE_FILL_TRANSPARENCY = 0.4;

/**
 * @param {Object} chartArea
 * @returns {string}
 */
function getMaxWidth(chartArea) {
    const {left, right} = chartArea;
    return Math.floor((right - left) / 1.618) + "px";
}

/**
 * Used to avoid too long legend items.
 * @param {string} label
 * @returns {string} shortened version of the input label
 */
function shortenLabel(label) {
    // string returned could be wrong if a groupby value contain a " / "!
    const groups = label.toString().split(SEP);
    let shortLabel = groups.slice(0, 3).join(SEP);
    if (shortLabel.length > 30) {
        shortLabel = `${shortLabel.slice(0, 30)}...`;
    } else if (groups.length > 3) {
        shortLabel = `${shortLabel}${SEP}...`;
    }
    return shortLabel;
}

export class GanttRenderer extends Component {
    setup() {
        this.model = this.props.model;
        this.onGraphClicked = this.props.onGraphClicked;
        this.rootRef = useRef("root");
        this.canvasRef = useRef("canvas");
        this.containerRef = useRef("container");
        this.cookies = useService("cookie");

        this.dataProcessor = null;
        // this.tooltip = null;
        // this.legendTooltip = null;

        onWillStart(() => loadJS("/web/static/lib/Chart/Chart.js"));

        useEffect(() => this.renderChart());
        onWillUnmount(this.onWillUnmount);
    }

    onWillUnmount() {

        if (this.dataProcessor) {
            this.dataProcessor.destructor();
            this.dataProcessor = null;
        }
    }

    /**
     * This function aims to remove a suitable number of lines from the
     * tooltip in order to make it reasonably visible. A message indicating
     * the number of lines is added if necessary.
     * @param {HTMLElement} tooltip
     * @param {number} maxTooltipHeight this the max height in pixels of the tooltip
     */
    adjustTooltipHeight(tooltip, maxTooltipHeight) {
        const sizeOneLine = tooltip.querySelector("tbody tr").clientHeight;
        const tbodySize = tooltip.querySelector("tbody").clientHeight;
        const toKeep = Math.max(
            0,
            Math.floor((maxTooltipHeight - (tooltip.clientHeight - tbodySize)) / sizeOneLine) - 1
        );
        const lines = tooltip.querySelectorAll("tbody tr");
        const toRemove = lines.length - toKeep;
        if (toRemove > 0) {
            for (let index = toKeep; index < lines.length; ++index) {
                lines[index].remove();
            }
            const tr = document.createElement("tr");
            const td = document.createElement("td");
            tr.classList.add("o_show_more", "text-center", "fw-bold");
            td.setAttribute("colspan", "2");
            td.innerText = this.env._t("...");
            tr.appendChild(td);
            tooltip.querySelector("tbody").appendChild(tr);
        }
    }

    /**
     * Creates a custom HTML tooltip.
     * @param {Object} data
     * @param {Object} metaData
     * @param {Object} tooltipModel see chartjs documentation
     */
    customTooltip(data, metaData, tooltipModel) {
        const {measure, measures, disableLinking, mode} = metaData;
        this.rootRef.el.style.cursor = "";
        // this.removeTooltips();
        if (tooltipModel.opacity === 0 || tooltipModel.dataPoints.length === 0) {
            return;
        }
        if (!disableLinking && mode !== "line") {
            this.rootRef.el.style.cursor = "pointer";
        }
        const chartAreaTop = this.chart.chartArea.top;
        const viewContentTop = this.rootRef.el.getBoundingClientRect().top;
        const innerHTML = renderToString("project_gantt.GanttRenderer.CustomTooltip", {
            maxWidth: getMaxWidth(this.chart.chartArea),
            measure: measures[measure].string,
            mode: this.model.metaData.mode,
            // tooltipItems: this.getTooltipItems(data, metaData, tooltipModel),
        });
        const template = Object.assign(document.createElement("template"), {innerHTML});
        const tooltip = template.content.firstChild;
        this.containerRef.el.prepend(tooltip);

        let top;
        const tooltipHeight = tooltip.clientHeight;
        const minTopAllowed = Math.floor(chartAreaTop);
        const maxTopAllowed = Math.floor(window.innerHeight - (viewContentTop + tooltipHeight)) - 2;
        const y = Math.floor(tooltipModel.y);
        if (minTopAllowed <= maxTopAllowed) {
            // Here we know that the full tooltip can fit in the screen.
            // We put it in the position where Chart.js would put it
            // if two conditions are respected:
            //  1: the tooltip is not cut (because we know it is possible to not cut it)
            //  2: the tooltip does not hide the legend.
            // If it is not possible to use the Chart.js proposition (y)
            // we use the best approximated value.
            if (y <= maxTopAllowed) {
                if (y >= minTopAllowed) {
                    top = y;
                } else {
                    top = minTopAllowed;
                }
            } else {
                top = maxTopAllowed;
            }
        } else {
            // Here we know that we cannot satisfy condition 1 above,
            // so we position the tooltip at the minimal position and
            // cut it the minimum possible.
            top = minTopAllowed;
            const maxTooltipHeight = window.innerHeight - (viewContentTop + chartAreaTop) - 2;
            // this.adjustTooltipHeight(tooltip, maxTooltipHeight);
        }
        // this.fixTooltipLeftPosition(tooltip, tooltipModel.x);
        // tooltip.style.top = Math.floor(top) + "px";

        this.tooltip = tooltip;
    }

    /**
     * Sets best left position of a tooltip approaching the proposal x.
     * @param {HTMLElement} tooltip
     * @param {number} x
     */
    fixTooltipLeftPosition(tooltip, x) {
        let left;
        const tooltipWidth = tooltip.clientWidth;
        const minLeftAllowed = Math.floor(this.chart.chartArea.left + 2);
        const maxLeftAllowed = Math.floor(this.chart.chartArea.right - tooltipWidth - 2);
        x = Math.floor(x);
        if (x < minLeftAllowed) {
            left = minLeftAllowed;
        } else if (x > maxLeftAllowed) {
            left = maxLeftAllowed;
        } else {
            left = x;
        }
        tooltip.style.left = `${left}px`;
    }

    /**
     * Used to format correctly the values in tooltips and yAxes.
     * @param {number} value
     * @param {boolean} [allIntegers=true]
     * @returns {string}
     */
    formatValue(value, allIntegers = true) {
        const largeNumber = Math.abs(value) >= 1000;
        if (allIntegers && !largeNumber) {
            return String(value);
        }
        if (largeNumber) {
            return formatFloat(value, {humanReadable: true, decimals: 2, minDigits: 1});
        }
        return formatFloat(value);
    }

    /**
     * Returns the bar chart data
     * @returns {Object}
     */
    getBarChartData() {
        // style data
        const {domains, stacked} = this.model.metaData;
        const data = this.model.data;
        for (let index = 0; index < data.datasets.length; ++index) {
            const dataset = data.datasets[index];
            // used when stacked
            if (stacked) {
                dataset.stack = domains[dataset.originIndex].description || "";
            }
            // set dataset color
            dataset.backgroundColor = getColor(index, this.cookies.current.color_scheme);
        }

        return data;
    }

    /**
     * Returns the chart config.
     * @returns {Object}
     */
    getChartConfig() {
        const {mode} = this.model.metaData;
        let data;
        data = this.model.data;
        const options = {};

        const test = (entity, action, data, id) => {
            console.log(entity)
            console.log(action)
            console.log(data)
            console.log(id)
        }

        return test;
    }

    /**
     * Returns an object used to style chart elements independently from
     * the datasets.
     * @returns {Object}
     */
    getElementOptions() {
        const {mode, stacked} = this.model.metaData;
        const elementOptions = {};
        if (mode === "bar") {
            elementOptions.rectangle = {borderWidth: 1};
        } else if (mode === "line") {
            elementOptions.line = {fill: stacked, tension: 0};
        }
        return elementOptions;
    }

    /**
     * @returns {Object}
     */
    getLegendOptions() {
        const {mode} = this.model.metaData;
        const data = this.model.data;
        const refLength = mode === "pie" ? data.labels.length : data.datasets.length;
        const legendOptions = {
            display: refLength <= 20,
            position: "top",
            onHover: this.onlegendHover.bind(this),
            onLeave: this.onLegendLeave.bind(this),
        };
        if (mode === "line") {
            legendOptions.onClick = this.onLegendClick.bind(this);
        }
        if (mode === "pie") {
            legendOptions.labels = {
                generateLabels: (chart) => {
                    const {data} = chart;
                    const metaData = data.datasets.map(
                        (_, index) => chart.getDatasetMeta(index).data
                    );
                    const labels = data.labels.map((label, index) => {
                        const hidden = metaData.some((data) => data[index] && data[index].hidden);
                        const fullText = label;
                        const text = shortenLabel(fullText);
                        const fillStyle =
                            label === NO_DATA
                                ? DEFAULT_BG
                                : getColor(index, this.cookies.current.color_scheme);
                        return {text, fullText, fillStyle, hidden, index};
                    });
                    return labels;
                },
            };
        } else {
            const referenceColor = mode === "bar" ? "backgroundColor" : "borderColor";
            legendOptions.labels = {
                generateLabels: (chart) => {
                    const {data} = chart;
                    const labels = data.datasets.map((dataset, index) => {
                        return {
                            text: shortenLabel(dataset.label),
                            fullText: dataset.label,
                            fillStyle: dataset[referenceColor],
                            hidden: !chart.isDatasetVisible(index),
                            lineCap: dataset.borderCapStyle,
                            lineDash: dataset.borderDash,
                            lineDashOffset: dataset.borderDashOffset,
                            lineJoin: dataset.borderJoinStyle,
                            lineWidth: dataset.borderWidth,
                            strokeStyle: dataset[referenceColor],
                            pointStyle: dataset.pointStyle,
                            datasetIndex: index,
                        };
                    });
                    return labels;
                },
            };
        }
        return legendOptions;
    }

    /**
     * Returns line chart data.
     * @returns {Object}
     */
    getLineChartData() {
        const {groupBy, domains, stacked, cumulated} = this.model.metaData;
        const data = this.model.data;
        const color0 = getColor(0, this.cookies.current.color_scheme);
        const color1 = getColor(1, this.cookies.current.color_scheme);
        for (let index = 0; index < data.datasets.length; ++index) {
            const dataset = data.datasets[index];
            if (groupBy.length <= 1 && domains.length > 1) {
                if (dataset.originIndex === 0) {
                    dataset.fill = "origin";
                    dataset.backgroundColor = hexToRGBA(color0, LINE_FILL_TRANSPARENCY);
                    dataset.borderColor = color0;
                } else if (dataset.originIndex === 1) {
                    dataset.borderColor = color1;
                } else {
                    dataset.borderColor = getColor(index, this.cookies.current.color_scheme);
                }
            } else {
                dataset.borderColor = getColor(index, this.cookies.current.color_scheme);
            }
            if (data.labels.length === 1) {
                // shift of the real value to right. This is done to
                // center the points in the chart. See data.labels below in
                // Chart parameters
                dataset.data.unshift(undefined);
                dataset.trueLabels.unshift(undefined);
                dataset.domains.unshift(undefined);
            }
            dataset.pointBackgroundColor = dataset.borderColor;
            dataset.pointBorderColor = "rgba(0,0,0,0.2)";
            if (stacked) {
                dataset.backgroundColor = hexToRGBA(dataset.borderColor, LINE_FILL_TRANSPARENCY);
            }
            if (cumulated) {
                let accumulator = 0;
                dataset.data = dataset.data.map((value) => {
                    accumulator += value;
                    return accumulator;
                });
            }
        }
        if (data.datasets.length === 1 && data.datasets[0].originIndex === 0) {
            const dataset = data.datasets[0];
            dataset.fill = "origin";
            dataset.backgroundColor = hexToRGBA(color0, LINE_FILL_TRANSPARENCY);
        }
        // center the points in the chart (without that code they are put
        // on the left and the graph seems empty)
        data.labels = data.labels.length > 1 ? data.labels : ["", ...data.labels, ""];

        return data;
    }

    /**
     * Returns pie chart data.
     * @returns {Object}
     */
    getPieChartData() {
        const {domains} = this.model.metaData;
        const data = this.model.data;
        // style/complete data
        // give same color to same groups from different origins
        const colors = data.labels.map((_, index) =>
            getColor(index, this.cookies.current.color_scheme)
        );
        const borderColor = getBorderWhite(this.cookies.current.color_scheme);
        for (const dataset of data.datasets) {
            dataset.backgroundColor = colors;
            dataset.borderColor = borderColor;
        }
        // make sure there is a zone associated with every origin
        const representedOriginIndexes = new Set(
            data.datasets.map((dataset) => dataset.originIndex)
        );
        let addNoDataToLegend = false;
        const fakeData = new Array(data.labels.length + 1);
        fakeData[data.labels.length] = 1;
        const fakeTrueLabels = new Array(data.labels.length + 1);
        fakeTrueLabels[data.labels.length] = NO_DATA;
        for (let index = 0; index < domains.length; ++index) {
            if (!representedOriginIndexes.has(index)) {
                data.datasets.push({
                    label: domains[index].description,
                    data: fakeData,
                    trueLabels: fakeTrueLabels,
                    backgroundColor: [...colors, DEFAULT_BG],
                    borderColor,
                });
                addNoDataToLegend = true;
            }
        }
        if (addNoDataToLegend) {
            data.labels.push(NO_DATA);
        }

        return data;
    }

    /**
     * Returns the options used to generate the chart axes.
     * @returns {Object}
     */
    getScaleOptions() {
        const {
            allIntegers,
            fields,
            groupBy,
            measure,
            measures,
            mode,
            stacked,
        } = this.model.metaData;
        if (mode === "pie") {
            return {};
        }
        const xAxe = {
            type: "category",
            scaleLabel: {
                display: Boolean(groupBy.length),
                labelString: groupBy.length ? fields[groupBy[0].fieldName].string : "",
            },
            ticks: {callback: (value) => shortenLabel(value)},
        };
        const yAxe = {
            type: "linear",
            scaleLabel: {
                labelString: measures[measure].string,
            },
            ticks: {
                callback: (value) => this.formatValue(value, allIntegers),
                suggestedMax: 0,
                suggestedMin: 0,
            },
            stacked: mode === "line" && stacked ? stacked : undefined,
        };
        return {xAxes: [xAxe], yAxes: [yAxe]};
    }

    /**
     * This function extracts the information from the data points in
     * tooltipModel.dataPoints (corresponding to datapoints over a given
     * label determined by the mouse position) that will be displayed in a
     * custom tooltip.
     * @param {Object} data
     * @param {Object} metaData
     * @param {Object} tooltipModel see chartjs documentation
     * @returns {Object[]}
     */
    getTooltipItems(data, metaData, tooltipModel) {
        const {allIntegers, domains, mode, groupBy} = metaData;
        const sortedDataPoints = sortBy(tooltipModel.dataPoints, "yLabel", "desc");
        const items = [];
        for (const item of sortedDataPoints) {
            const index = item.index;
            const dataset = data.datasets[item.datasetIndex];
            let label = dataset.trueLabels[index];
            let value = this.formatValue(dataset.data[index], allIntegers);
            let boxColor;
            let percentage;
            if (mode === "pie") {
                if (label === NO_DATA) {
                    value = this.formatValue(0, allIntegers);
                }
                if (domains.length > 1) {
                    label = `${dataset.label} / ${label}`;
                }
                boxColor = dataset.backgroundColor[index];
                const totalData = dataset.data.reduce((a, b) => a + b, 0);
                percentage = totalData && ((dataset.data[item.index] * 100) / totalData).toFixed(2);
            } else {
                if (groupBy.length > 1 || domains.length > 1) {
                    label = `${label} / ${dataset.label}`;
                }
                boxColor = mode === "bar" ? dataset.backgroundColor : dataset.borderColor;
            }
            items.push({label, value, boxColor, percentage});
        }
        return items;
    }

    /**
     * Returns the options used to generate chart tooltips.
     * @returns {Object}
     */
    getTooltipOptions() {
        const {data, metaData} = this.model;
        const {mode} = metaData;
        const tooltipOptions = {
            enabled: false,
            // custom: this.customTooltip.bind(this, data, metaData),
        };
        if (mode === "line") {
            tooltipOptions.mode = "index";
            tooltipOptions.intersect = false;
        }
        return tooltipOptions;
    }

    /**
     * If a group has been clicked on, display a view of its records.
     * @param {MouseEvent} ev
     */
    onGraphClicked(ev) {
        const [activeElement] = this.chart.getElementAtEvent(ev);
        if (!activeElement) {
            return;
        }
        const {_datasetIndex, _index} = activeElement;
        const {domains} = this.chart.data.datasets[_datasetIndex];
        if (domains) {
            this.props.onGraphClicked(domains[_index]);
        }
    }

    /**
     * Overrides the default legend 'onClick' behaviour. This is done to
     * remove all existing tooltips right before updating the chart.
     * @param {Event} ev
     * @param {Object} legendItem
     */
    onLegendClick(ev, legendItem) {
        // this.removeTooltips();
        // Default 'onClick' fallback. See web/static/lib/Chart/Chart.js#15138
        const index = legendItem.datasetIndex;
        const meta = this.chart.getDatasetMeta(index);
        meta.hidden = meta.hidden === null ? !this.chart.data.datasets[index].hidden : null;
        this.chart.update();
    }

    /**
     * If the text of a legend item has been shortened and the user mouse
     * hovers that item (actually the event type is mousemove), a tooltip
     * with the item full text is displayed.
     * @param {Event} ev
     * @param {Object} legendItem
     */
    onlegendHover(ev, legendItem) {
        this.canvasRef.el.style.cursor = "pointer";
        /**
         * The string legendItem.text is an initial segment of legendItem.fullText.
         * If the two coincide, no need to generate a tooltip. If a tooltip
         * for the legend already exists, it is already good and does not
         * need to be recreated.
         */
        const {fullText, text} = legendItem;
        if (this.legendTooltip || text === fullText) {
            return;
        }
        const viewContentTop = this.rootRef.el.getBoundingClientRect().top;
        const legendTooltip = Object.assign(document.createElement("div"), {
            className: "o_tooltip_legend popover p-3 pe-none",
            innerText: fullText,
        });
        legendTooltip.style.top = `${ev.clientY - viewContentTop}px`;
        legendTooltip.style.maxWidth = getMaxWidth(this.chart.chartArea);
        this.containerRef.el.appendChild(legendTooltip);
        // this.fixTooltipLeftPosition(legendTooltip, ev.clientX);
        // this.legendTooltip = legendTooltip;
    }

    /**
     * If there's a legend tooltip and the user mouse out of the
     * corresponding legend item, the tooltip is removed.
     */
    onLegendLeave() {
        this.canvasRef.el.style.cursor = "";
        // this.removeLegendTooltip();
    }

    /**
     * Prepares options for the chart according to the current mode
     * (= chart type). This function returns the parameter options used to
     * instantiate the chart.
     */
    prepareOptions() {
        const {disableLinking, mode} = this.model.metaData;
        const options = {
            maintainAspectRatio: false,
            // scales: this.getScaleOptions(),
            // legend: this.getLegendOptions(),
            // tooltips: this.getTooltipOptions(),
            // elements: this.getElementOptions(),
        };
        if (!disableLinking && mode !== "line") {
            options.onClick = this.onGraphClicked.bind(this);
        }
        return options;
    }

    /**
     * Removes the legend tooltip (if any).
     */
    removeLegendTooltip() {
        if (this.legendTooltip) {
            this.legendTooltip.remove();
            this.legendTooltip = null;
        }
    }

    /**
     * Removes all existing tooltips (if any).
     */
    removeTooltips() {
        if (this.tooltip) {
            this.tooltip.remove();
            this.tooltip = null;
        }
        // this.removeLegendTooltip();
    }

    /**
     * Instantiates a Chart (Chart.js lib) to render the graph according to
     * the current config.
     */
    renderChart() {

        gantt.config.order_branch = true;
        gantt.config.order_branch_free = true;
        gantt.config.date_format = "%Y-%m-%d %H:%i";

        this.dataProcessor = gantt.createDataProcessor(this.model.config);
        const t = this
        // gantt.attachEvent("onTaskDblClick", function (id, e) {
        //     var task = gantt.getTask(id);
        //     if(task.type !==  "milestone"){
        //          t.onGraphClicked(Number(id))
        //     return false;
        //     }
        // });

        let opened_ids = JSON.parse(localStorage.getItem("opened_tasks")) || [];
        gantt.attachEvent("onTaskOpened", function (id) {
            opened_ids.push(id);
            localStorage.setItem("opened_tasks", JSON.stringify(opened_ids));
        });

        gantt.attachEvent("onTaskClosed", function (id) {
             let closed_ids = JSON.parse(localStorage.getItem("opened_tasks")) || [];
            let index = closed_ids.indexOf(id);
            if (index > -1) {
                closed_ids.splice(index, 1);
                opened_ids.splice(index, 1)
            }
            localStorage.setItem("opened_tasks", JSON.stringify(closed_ids))
        });


        gantt.templates.grid_row_class = function (start, end, task) {
            if (task.model === 'project.project' || task.type === 'milestone') {
                return "nested_task"
            }
            return "";
        };
        gantt.serverList("users", this.model.all_user_names);
        var task_sections = [
            {name: "description", height: 60, map_to: "text", type: "textarea", focus: true},
            {name: "user", height: 22, map_to: "user", type: "multiselect",},
            {name: "time", height: 72, map_to: "auto", type: "duration"}
        ];
        var task_project_sections = [
            {name: "description", height: 60, map_to: "text", type: "textarea", focus: true},
            {name: "user", height: 22, map_to: "user", type: "multiselect",},
            {name: "time", height: 72, map_to: "auto", type: "duration", readonly: true}
        ];
        var milestone_sections = [
            {name: "description", height: 60, map_to: "text", type: "textarea"},
            {name: "time", height: 72, map_to: "auto", type: "duration", single_date: true}
        ];
        var project_sectionss = [
            {name: "description", height: 60, map_to: "text", type: "textarea"},
            {name: "time", height: 72, map_to: "auto", type: "duration", readonly: true}
        ];

        gantt.attachEvent("onBeforeLightbox", function (id) {
            var task = gantt.getTask(id);
            if (task.type === 'task') {
                gantt.locale.labels.section_description = 'Task Name'
                gantt.config.lightbox.sections = task_sections
            } else if (task.type === 'project') {
                gantt.locale.labels.section_description = 'Task Name'
                gantt.config.lightbox.project_sections = task_project_sections
            } else if (task.type === 'milestone') {
                gantt.locale.labels.section_description = 'Milestone Name'
                gantt.config.lightbox.milestone_sections = milestone_sections;
            } else if (task.model === 'project.project') {
                gantt.locale.labels.section_description = 'Project Name'
                gantt.config.lightbox.sections = project_sectionss;
            }
            return true;
        });

        gantt.attachEvent("onBeforeTaskDrag", function (id, mode, e) {
            var task = gantt.getTask(id)
            if (mode === "resize" || mode === "move") {
                if (task.type === 'task' || task.type === 'milestone') {
                    return true;
                } else {
                    return false;
                }
            }
        });

        gantt.attachEvent("onBeforeRowDragEnd", function (id, parent, tindex) {
            const task = gantt.getTask(id);
            if (task.model === 'project.project') {
                return false;
            } else {
                return true;
            }
        });

        // gantt.plugins({
        //     undo: true
        // });
        // var stack = gantt.getUndoStack();
        // console.log("gantt.getUndoStack()", stack)
        // console.log(" undo",gantt.ext.undo)
        // gantt.attachEvent("onAfterTaskDrag", function (id, mode, e) {
        //     gantt.confirm({
        //         text: "Do you want to change task position?",
        //         ok: "Yes",
        //         cancel: "No",
        //         callback: function (result) {
        //             console.log(result)
        // if (!result) {
        //     console.log(gantt.ext.undo.undo())
        // }
        // }
        // });
        // return true;
        // });

        let zoomConfig = {
            levels: [
                {
                    name: "day",
                    scale_height: 27,
                    min_column_width: 80,
                    scales: [
                        {unit: "day", step: 1, format: "%d %M"}
                    ]
                },
                {
                    name: "week",
                    scale_height: 50,
                    min_column_width: 50,
                    scales: [
                        {
                            unit: "week", step: 1, format: function (date) {
                                let dateToStr = gantt.date.date_to_str("%d %M");
                                let endDate = gantt.date.add(date, -6, "day");
                                let weekNum = gantt.date.date_to_str("%W")(date);
                                return "#" + weekNum + ", " + dateToStr(date) + " - " + dateToStr(endDate);
                            }
                        },
                        {unit: "day", step: 1, format: "%j %D"}
                    ]
                },
                {
                    name: "month",
                    scale_height: 50,
                    min_column_width: 120,
                    scales: [
                        {unit: "month", format: "%F, %Y"},
                        {unit: "week", format: "Week #%W"}
                    ]
                },
                {
                    name: "quarter",
                    height: 50,
                    min_column_width: 90,
                    scales: [
                        {unit: "month", step: 1, format: "%M"},
                        {
                            unit: "quarter", step: 1, format: function (date) {
                                let dateToStr = gantt.date.date_to_str("%M");
                                let endDate = gantt.date.add(gantt.date.add(date, 3, "month"), -1, "day");
                                return dateToStr(date) + " - " + dateToStr(endDate);
                            }
                        }
                    ]
                },
                {
                    name: "year",
                    scale_height: 50,
                    min_column_width: 30,
                    scales: [
                        {unit: "year", step: 1, format: "%Y"}
                    ]
                }
            ]
        };


        gantt.ext.zoom.init(zoomConfig);
        gantt.ext.zoom.setLevel("week");

        const {data} = this.model;
        gantt.init("gantt_here");
        gantt.clearAll();
        gantt.parse(data);
        gantt.config.sort = true; // Enable sorting on each columns
        gantt.sort("start_date", false) // the sorting direction: true - descending, false - ascending
        gantt.config.drag_progress = false;

        gantt.templates.rightside_text = function (start, end, task) {
            if (task.type == gantt.config.types.milestone) {
                return task.text;
            }
            if (task.type == gantt.config.types.task) {
                return task.user;
            }
            return "";
        };
        gantt.templates.progress_text = function (start, end, task) {
            return "<span style='margin-left: 10px;'>" + Math.round(task.progress * 100) + "% </span>";
        };
        gantt.config.grid_resize = true;
        gantt.config.multiselect = true;
        gantt.config.multiselect_one_level = true;

        if (this.model.metaData.resModel === 'project.task') {
            gantt.config.grid_width = 460;
            gantt.config.columns = [
                {name: "user", label: "Assignees", width: '200', resize: true, align: "left"},
                {name: "text", label: "Task Name", width: '300', resize: true, align: "left", tree: true},
                {name: "start_date", label: "Start Date", align: "center", width: 130, resize: true},
                {name: "duration", align: "center", width: 50, resize: true},
                {name: "add", width: 30,}
            ];
        } else if (this.model.metaData.resModel === 'project.project') {
            gantt.config.columns = [
                {name: "text", label: "Project", width: '170', resize: true, align: "center"},
                {name: "start_date", label: "Start Date", align: "center", width: 110, resize: true},
                {name: "duration", align: "center", width: 50, resize: true},
                {name: "add", width: 30,}
            ];
        }
    }
}

GanttRenderer.template = "project_gantt.GanttRenderer";
GanttRenderer.props = ["class?", "model", "onGraphClicked"];
