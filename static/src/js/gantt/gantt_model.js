/** @odoo-module **/

import {sortBy} from "@web/core/utils/arrays";
import {KeepLast, Race} from "@web/core/utils/concurrency";
import {rankInterval} from "@web/search/utils/dates";
import {getGroupBy} from "@web/search/utils/group_by";
import {GROUPABLE_TYPES} from "@web/search/utils/misc";
import {Model} from "@web/views/model";
import {computeReportMeasures, processMeasure} from "@web/views/utils";
import {useEffect} from "@odoo/owl";

export const SEP = " / ";

/**
 * @typedef {import("@web/search/search_model").SearchParams} SearchParams
 */

class DateClasses {
    // We view the param "array" as a matrix of values and undefined.
    // An equivalence class is formed of defined values of a column.
    // So nothing has to do with dates but we only use Dateclasses to manage
    // identification of dates.
    /**
     * @param {(any[])[]} array
     */
    constructor(array) {
        this.__referenceIndex = null;
        this.__array = array;
        for (let i = 0; i < this.__array.length; i++) {
            const arr = this.__array[i];
            if (arr.length && this.__referenceIndex === null) {
                this.__referenceIndex = i;
            }
        }
    }

    /**
     * @param {number} index
     * @param {any} o
     * @returns {string}
     */
    classLabel(index, o) {
        return `${this.__array[index].indexOf(o)}`;
    }

    /**
     * @param {string} classLabel
     * @returns {any[]}
     */
    classMembers(classLabel) {
        const classNumber = Number(classLabel);
        const classMembers = new Set();
        for (const arr of this.__array) {
            if (arr[classNumber] !== undefined) {
                classMembers.add(arr[classNumber]);
            }
        }
        return [...classMembers];
    }

    /**
     * @param {string} classLabel
     * @param {number} [index]
     * @returns {any}
     */
    representative(classLabel, index) {
        const classNumber = Number(classLabel);
        const i = index === undefined ? this.__referenceIndex : index;
        if (i === null) {
            return null;
        }
        return this.__array[i][classNumber];
    }

    /**
     * @param {number} index
     * @returns {number}
     */
    arrayLength(index) {
        return this.__array[index].length;
    }
}

export class GanttModel extends Model {
    /**
     * @override
     */
    setup(params) {
        // concurrency management
        this.keepLast = new KeepLast();
        this.race = new Race();
        const _fetchData = this._fetchData.bind(this);
        this._fetchData = (...args) => {
            return this.race.add(_fetchData(...args));
        };
        this.initialGroupBy = null;
        this.metaData = params;
        this.data = null;
        this.milestones = null;
        this.searchParams = null;
        this.config = this._getDataProcessorConfiguration();
        this.now = new Date();
        this.combined_id_name = null;
    }

    //--------------------------------------------------------------------------
    // Public
    //--------------------------------------------------------------------------

    /**
     * @param {SearchParams} searchParams
     */
    async load(searchParams) {
        this.searchParams = searchParams;
        if (!this.initialGroupBy) {
            this.initialGroupBy = searchParams.context.graph_groupbys || this.metaData.groupBy; // = arch groupBy --> change that
        }
        const metaData = this._buildMetaData();

        return this._fetchData(metaData);
    }

    /**
     * @override
     */
    hasData() {
        return this.dataPoints.length > 0;
    }

    /**
     * Only supposed to be called to change one or several parameters among
     * "measure", "mode", "order", "stacked" and "cumulated".
     * @param {Object} params
     */
    async updateMetaData(params) {
        if ("measure" in params) {
            const metaData = this._buildMetaData(params);
            await this._fetchData(metaData);
            this.useSampleModel = false;
        }
        else {
            await this.race.getCurrentProm();
            const metaData = this._buildMetaData(params);
            await this._fetchData(metaData);
            this.metaData = Object.assign({}, this.metaData, params);
            this._prepareData();
        }
        this.notify();
    }

    async updateSpecificData(data){
this.notify();
    }

    get scale() {
        return this.metaData.scale;
    }

    get scales() {
        return this.metaData.scales;
    }

    //--------------------------------------------------------------------------
    // Protected
    //--------------------------------------------------------------------------

    /**
     * @protected
     * @param {}
     * @returns {DataProcessorConfiguration}
     */
    _getDataProcessorConfiguration() {
        const _t = this

        return {
            task: {
                create: function (data) {
                    _t.createTask(data)
                },
                update: function (data, id) {
                    _t.updateTask(id, data)
                },
                delete: function (data) {
                }
            },
            link: {
                create: function (data) {
                    if (data.type === '0') {
                        _t.createLink(data)
                    }
                },
                update: function (data, id) {
                },
                delete: function (id) {
                    _t.deleteLink(id)
                }
            }
        }
    }

    async createTask(data) {
        let _task = {
            name: data.text,
            date_start: data.start_date,
            date_deadline: data.end_date,
            parent_id: data.parent,
            project_id: this.metaData.context.active_id,
        }
        await this.orm.create(this.metaData.resModel, [_task])
        // this.model.updateMetaData(this.metaData);
    }

    async updateTask(id, data) {
        const _task = {
            name: data.text,
            date_start: data.start_date,
            date_deadline: data.end_date,
            parent_id: data.parent,
        }
        await this.orm.write(this.metaData.resModel, [Number(id)], _task);
    }

    async createLink(link) {
        const args = [
            [Number(link.target)],
            {"depend_on_ids": [[6, false, [Number(link.source)]]]}
        ]
        const linked =await this.orm.call(this.metaData.resModel, 'write', args);
        console.log(linked)
    }

    async deleteLink(id) {
        const args = [
            [Number(id)],
            {"depend_on_ids": [[6, false, []]]}
        ]
        this.orm.call(this.metaData.resModel, 'write', args)
    }


    /**
     * @protected
     * @param {Object} [params={}]
     * @returns {Object}
     */
    _buildMetaData(params) {
        const {comparison, domain, context, groupBy} = this.searchParams;

        const metaData = Object.assign({}, this.metaData, {context});
        if (comparison) {
            metaData.domains = comparison.domains;
            metaData.comparisonField = comparison.fieldName;
        } else {
            metaData.domains = [{arrayRepr: domain, description: null}];
        }
        metaData.measure = context.graph_measure || metaData.measure;
        metaData.mode = context.graph_mode || metaData.mode;
        metaData.groupBy = groupBy.length ? groupBy : this.initialGroupBy;
        if (metaData.mode !== "pie") {
            metaData.order = "graph_order" in context ? context.graph_order : metaData.order;
            metaData.stacked = "graph_stacked" in context ? context.graph_stacked : metaData.stacked;
            if (metaData.mode === "line") {
                metaData.cumulated = "graph_cumulated" in context ? context.graph_cumulated : metaData.cumulated;
            }
        }

        this._normalize(metaData);

        metaData.measures = computeReportMeasures(metaData.fields, metaData.fieldAttrs, [
            metaData.measure,
        ]);

        return Object.assign(metaData, params);
    }

    /**
     * Fetch the data points determined by the metaData. This function has
     * several side effects. It can alter this.metaData and set this.dataPoints.
     * @protected
     * @param {Object} metaData
     */
    async _fetchData(metaData) {
        this.data = await this.keepLast.add(this._loadData(metaData));
        this.metaData = metaData;
        this._prepareData();
    }

    /**
     * Determines the dataset to which the data point belongs.
     * @protected
     * @param {Object} dataPoint
     * @returns {string}
     */
    _getDatasetLabel(dataPoint) {
        const {measure, measures, domains, mode} = this.metaData;
        const {labels, originIndex} = dataPoint;
        if (mode === "pie") {
            return domains[originIndex].description || "";
        }
        // ([origin] + second to last groupBys) or measure
        let datasetLabel = labels.slice(1).join(SEP);
        if (domains.length > 1) {
            datasetLabel =
                domains[originIndex].description + (datasetLabel ? SEP + datasetLabel : "");
        }
        datasetLabel = datasetLabel || measures[measure].string;
        return datasetLabel;
    }

    /**
     * @protected
     * @param {Object[]} dataPoints
     * @returns {DateClasses}
     */
    _getDateClasses(dataPoints) {
        const {domains} = this.metaData;
        const dateSets = domains.map(() => new Set());
        for (const {labels, originIndex} of dataPoints) {
            const date = labels[0];
            dateSets[originIndex].add(date);
        }
        const arrays = dateSets.map((dateSet) => [...dateSet]);
        return new DateClasses(arrays);
    }

    /**
     * Eventually filters and sort data points.
     * @protected
     * @returns {Object[]}
     */
    _getProcessedDataPoints() {
        const {domains, groupBy, mode, order} = this.metaData;

        let processedDataPoints = [];
        // if (mode === "line") {
        //     processedDataPoints = this.dataPoints.filter(
        //         (dataPoint) => dataPoint.labels[0] !== this.env._t("Undefined")
        //     );
        // } else {
        //     processedDataPoints = this.dataPoints.filter((dataPoint) => dataPoint.count !== 0);
        // }

        // if (order !== null && mode !== "pie" && domains.length === 1 && groupBy.length > 0) {
        //     // group data by their x-axis value, and then sort datapoints
        //     // based on the sum of values by group in ascending/descending order
        //     const groupedDataPoints = {};
        //     for (const dataPt of processedDataPoints) {
        //         const key = dataPt.labels[0]; // = x-axis value under the current assumptions
        //         if (!groupedDataPoints[key]) {
        //             groupedDataPoints[key] = [];
        //         }
        //         groupedDataPoints[key].push(dataPt);
        //     }
        //     const groups = Object.values(groupedDataPoints);
        //     const groupTotal = (group) => group.reduce((sum, dataPt) => sum + dataPt.value, 0);
        //     processedDataPoints = sortBy(groups, groupTotal, order.toLowerCase()).flat();
        // }

        return this.dataPoints;
        // return processedDataPoints;
    }

    /**
     * Determines whether the set of data points is good. If not, this.data will be (re)set to null
     * @protected
     * @param {Object[]}
     * @returns {boolean}
     */
    _isValidData(dataPoints) {
        const {mode} = this.metaData;
        let somePositive = false;
        if (mode === "pie") {
            for (const dataPt of dataPoints) {
                if (dataPt.value > 0) {
                    somePositive = true;
                }
            }
            return somePositive;
        }
        return true;
    }

    /**
     * Fetch and process graph data.  It is basically a(some) read_group(s)
     * with correct fields for each domain.  We have to do some light processing
     * to separate date groups in the field list, because they can be defined
     * with an aggregation function, such as my_date:week.
     * @protected
     * @param {Object} metaData
     * @returns {Object[]}
     */
    async _loadData(metaData) {

        const {measure, domains, fields, groupBy, resModel} = metaData;

        const measures = ["__count"];
        if (measure !== "__count") {
            let {group_operator, type} = fields[measure];
            if (type === "many2one") {
                group_operator = "count_distinct";
            }
            if (group_operator === undefined) {
                throw new Error(
                    `No aggregate function has been provided for the measure '${measure}'`
                );
            }
            measures.push(`${measure}:${group_operator}`);
        }

        const proms = [];
        const milestones = [];
        const user_ids = [];
        const numbering = {}; // used to avoid ambiguity with many2one with values with same labels:
        // for instance [1, "ABC"] [3, "ABC"] should be distinguished.

        let columns = [];
        switch (resModel) {
            case "project.project":
                columns = ['id', 'name', 'date_start', 'date'];
                break;
            case "project.task":
                columns = ['id', 'name', 'date_start', 'date_assign', 'create_date', 'date_end', 'planned_hours', 'subtask_planned_hours', 'subtask_effective_hours', 'date_deadline', 'parent_id', 'milestone_id', 'progress', 'child_ids', 'ancestor_id', 'depend_on_ids', 'user_ids'];
                break;
            default:
                break;
        }

        domains.forEach((domain, originIndex) => {
            proms.push(this.orm
                .searchRead(resModel, domain.arrayRepr, columns, {})
                .then((data) => {
                    return data;

                }));

            if (resModel === 'project.task') {
                milestones.push(this.orm
                    .searchRead("project.milestone", [["project_id", "=", domain.arrayRepr[0][2]]], ['id', 'project_id', 'name', 'deadline', 'reached_date'], {})
                    .then((milestoneData) => {
                        return milestoneData;
                    }));
            }

            if (resModel === 'project.task') {
                user_ids.push(this.orm
                    .searchRead("project.task", [["project_id", "=", domain.arrayRepr[0][2]]], ['user_ids'], {})
                    .then((data) => {
                        return data;
                    }));
            }
        });

        const user_ids_promise = await Promise.all(user_ids);
        const user_ids_flat = user_ids_promise.flat();
        const user_ids_fields = []
        user_ids_flat.forEach((user) => {
            user_ids_fields.push(user.user_ids)
        })
        const removed_user_ids_duplicate = [...new Set(user_ids_fields.flat())];
        const user_ids_partner_id = [];
        user_ids_partner_id.push(this.orm.searchRead("res.users", [["id", "=", removed_user_ids_duplicate]], ['id', 'partner_id'], {})
            .then((data) => {
                return data;
            }));
        const user_ids_partner_id_promise = await Promise.all(user_ids_partner_id)
        const user_ids_partner_id_flat = user_ids_partner_id_promise.flat();
        const user_id_partner_id = [];
        user_ids_partner_id_flat.forEach((id) => {
            const id_name = {
                id: id.id,
                name: id.partner_id[1]
            }
            user_id_partner_id.push(id_name)
        })
        this.combined_id_name = user_id_partner_id;

        const All_data = await Promise.all(proms);
        const milestoneData = await Promise.all(milestones);
        this.milestones = milestoneData.flat();
        return All_data.flat();
    }

    /**
     * Process metaData.groupBy in order to keep only the finest interval option for
     * elements based on date/datetime field (e.g. 'date:year'). This means that
     * 'week' is prefered to 'month'. The field stays at the place of its first occurence.
     * For instance,
     * ['foo', 'date:month', 'bar', 'date:week'] becomes ['foo', 'date:week', 'bar'].
     * @protected
     * @param {Object} metaData
     */
    _normalize(metaData) {
        const {fields} = metaData;
        const groupBy = [];
        for (const gb of metaData.groupBy) {
            let ngb = gb;
            if (typeof gb === "string") {
                ngb = getGroupBy(gb, fields);
            }
            groupBy.push(ngb);
        }

        const processedGroupBy = [];
        for (const gb of groupBy) {
            const {fieldName, interval} = gb;
            const {sortable, type, store} = fields[fieldName];
            if (
                // many2many is groupable precisely when it is stored (cf. groupable in odoo/fields.py)
                (type === "many2many" ? !store : !sortable) ||
                ["id", "__count"].includes(fieldName) ||
                !GROUPABLE_TYPES.includes(type)
            ) {
                continue;
            }
            const index = processedGroupBy.findIndex((gb) => gb.fieldName === fieldName);
            if (index === -1) {
                processedGroupBy.push(gb);
            } else if (interval) {
                const registeredInterval = processedGroupBy[index].interval;
                if (rankInterval(registeredInterval) < rankInterval(interval)) {
                    processedGroupBy.splice(index, 1, gb);
                }
            }
        }
        metaData.groupBy = processedGroupBy;

        metaData.measure = processMeasure(metaData.measure);
    }

    /**
     * @protected
     */


    async _prepareData() {
        const data = []
        const links = []

        this.data.forEach(task => {
            switch (this.metaData.resModel) {

                case "project.project":
                    const _ta = {
                        id: task.id,
                        text: task.name,
                        start_date: task.date_start,
                        end_date: task.date,
                        // duration:5,
                        parent: 0,
                        progress: 0,
                        // type: "project"
                    }

                    data.push(_ta)
                    break;
                case "project.task":
                    const _task = {
                        id: task.id,
                        text: task.name,
                        start_date: task.date_start,
                        end_date: task.date_deadline,
                        parent: task.parent_id[0],
                        progress: task.progress / 100,
                        type: "task",
                        user: task.user_ids,
                        open: true,
                    }
                    if (task.child_ids.length > 0) {
                        _task.type = 'project';
                        _task.progress = task.subtask_effective_hours / task.subtask_planned_hours;
                    }
                    if (task.date_start === false) {
                        if (task.date_assign) {
                            _task.start_date = task.date_assign;
                        } else {
                            _task.start_date = task.create_date;
                        }
                    }
                    if (task.date_deadline === false) {
                        if (task.date_end) {
                            _task.end_date = task.date_end;
                        } else {
                            _task.end_date = this.now;
                        }
                    }
                    data.push(_task)
                    if (task.depend_on_ids.length > 0) {
                        task.depend_on_ids.map(depend_id => {
                            const _link = {
                                id: task.id,
                                source: depend_id,
                                target: task.id,
                                type: '0'
                            }
                            links.push(_link)
                        })
                    }

                    break;
                default:
                    break;
            }

        })

        if (this.milestones) {
            this.milestones.forEach(milestone => {
                const _miles = {
                    id: generateKey(8),
                    text: milestone.name,
                    start_date: milestone.deadline,
                    end_date: milestone.reached_date,
                    type: "milestone",
                }
                data.push(_miles);
            })
        }
        this.data = null

        this.data = {data, links}

    }

}

function generateKey(length) {
    let result = '';
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const charactersLength = characters.length;
    let counter = 0;
    while (counter < length) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
        counter += 1;
    }
    return result;
}
