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
        this.all_user_names = null;
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
        } else {
            await this.race.getCurrentProm();
            const metaData = this._buildMetaData(params);
            await this._fetchData(metaData);
            this.metaData = Object.assign({}, this.metaData, params);
            this._prepareData();
        }
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
                delete: function (id) {
                    _t.deleteTask(id)
                }
            },
            link: {
                create: function (data) {
                    if (data.type === '0') {
                        _t.createLink(data)
                    }
                },
                update: function (id, data) {
                    // _t.updateLink(id, data)
                },
                delete: function (id) {
                    _t.deleteLink(id)
                }
            }
        }
    }

    async createTask(data) {
        if (this.metaData.resModel === 'project.task') {
            let _task = {
                name: data.text,
                date_start: data.start_date,
                date_deadline: data.end_date,
                parent_id: data.parent,
                project_id: this.metaData.context.active_id,
            }
            let task_id = await this.orm.create(this.metaData.resModel, [_task])

            if (task_id) {
                gantt.changeTaskId(data.id, task_id);
            }

            let args = [[Number(task_id)], {user_ids: [[6, false, data.multiple_asssign.map(strid => Number(strid))]]}]
            const orm_call = await this.orm.call("project.task", 'write', args)

            if (orm_call) {
                let results = [];
                if (data.multiple_asssign) {
                    data.multiple_asssign.map(userid => {
                        for (let l = 0; l < this.all_user_names.length; l++) {
                            if (Number(userid) === this.all_user_names[l].key) {
                                results.push(this.all_user_names[l].label);
                            }
                        }
                    });
                }
                gantt.getTask(Number(task_id)).user = results;
                gantt.refreshTask(Number(task_id));
            }

        } else if (this.metaData.resModel === 'project.project') {
            let _task = {
                name: data.text,
            }
            const project_id = await this.orm.create(this.metaData.resModel, [_task])
            if (project_id) {
                gantt.changeTaskId(data.id, project_id);
            }
        }
    }

    async parentProgress(id) {
        gantt.eachParent(function (task) {
            const children = gantt.getChildren(task.id);
            let childProgress = 0;
            for (let i = 0; i < children.length; i++) {
                const child = gantt.getTask(children[i])
                childProgress += (child.progress * 100);
            }
            gantt.getTask(Number(task.id)).progress = childProgress / children.length / 100;
            gantt.refreshTask(Number(id))
        }, id)
    }

    async updateTask(id, data) {
        if (data.model === 'project.task') {
            const _task = {
                name: data.text,
                date_start: data.start_date,
                date_deadline: data.end_date,
                parent_id: Number(data.parent),
            }

            let userids = {user_ids: [[6, false, data.multiple_asssign.map(strid => Number(strid))]]}
            if (data.personal_stage_typeid === false) {
                userids = {
                    personal_stage_type_id: false,
                    user_ids: [[6, false, data.multiple_asssign.map(strid => Number(strid))]]
                }
            }

            let args = [[Number(id)], userids]
            const orm_write = await this.orm.write("project.task", [Number(id)], _task);
            const orm_call = await this.orm.call("project.task", 'write', args)

            if (orm_call === true) {
                let result = [];
                if (data.multiple_asssign) {
                    data.multiple_asssign.map(userid => {
                        for (let l = 0; l < this.all_user_names.length; l++) {
                            if (Number(userid) === this.all_user_names[l].key) {
                                result.push(" " + this.all_user_names[l].label);
                            }
                        }
                    });
                }
                gantt.getTask(Number(id)).user = result;
                gantt.refreshTask(Number(id));
            }
            if(orm_write){
                this.parentProgress(Number(id))
            }


        } else if (data.type === 'milestone') {
            const _task = {
                name: data.text,
                deadline: data.start_date,
            }
            await this.orm.write('project.milestone', [Number(id.substring(3))], _task);
        } else if (data.model === 'project.project') {
            const _task = {
                name: data.text,
            }
            await this.orm.write('project.project', [Number(id)], _task);
        }
    }

    async deleteTask(id) {
        let id_string = id.toString();
        if (!id_string.includes('MLT')) {
            if (this.metaData.resModel === 'project.task') {
                await this.orm.unlink("project.task", [Number(id)]);
            } else if (this.metaData.resModel === 'project.project') {
                await this.orm.unlink("project.project", [Number(id)]);
            }
        } else {
            await this.orm.unlink("project.milestone", [Number(id.substring(3))]);
        }
    }

    async createLink(link) {
        if (this.metaData.resModel === 'project.task') {
            const args = [
                [Number(link.target)],
                {"depend_on_ids": [[6, false, [Number(link.source)]]]}
            ]
            const task_linked = await this.orm.call(this.metaData.resModel, 'write', args);
            if(task_linked){
                gantt.changeLinkId(link.id, link.target);
            }

        } else if (this.metaData.resModel === 'project.project') {

        }
    }

    async deleteLink(id) {
        if (this.metaData.resModel === 'project.task') {
            const args = [
                [Number(id)],
                {"depend_on_ids": [[6, false, []]]}
            ]
            this.orm.call(this.metaData.resModel, 'write', args)
        } else if (this.metaData.resModel === 'project.project') {

        }

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
        const user_id = [];
        const numbering = {}; // used to avoid ambiguity with many2one with values with same labels:
        // for instance [1, "ABC"] [3, "ABC"] should be distinguished.

        let columns = [];
        switch (resModel) {
            case "project.project":
                columns = ['id', 'name', 'date_start', 'date', 'tasks', 'exact_start_date', 'exact_end_date', 'project_progress'];
                break;
            case "project.task":
                columns = ['id', 'name', 'date_start', 'date_assign', 'create_date', 'date_end', 'planned_hours', 'subtask_planned_hours', 'subtask_effective_hours', 'date_deadline', 'parent_id', 'milestone_id', 'progress', 'child_ids', 'ancestor_id', 'depend_on_ids', 'user_ids', 'portal_user_names', 'personal_stage_type_id'];
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
        });

        user_id.push(this.orm.searchRead("res.users", [], ['partner_id'], {})
            .then((data) => {
                return data;
            }));
        const user_ids = await Promise.all(user_id);
        const user_ids_flat = user_ids.flat();
        const user = [];
        user_ids_flat.forEach((user_data) => {
            let user_name = user_data.partner_id[1]
            if(user_name.includes('YourCompany,')){
               user_name = user_name.replace("YourCompany,", "");
            }
            const users = {
                key: user_data.id,
                label: user_name
            }
            user.push(users);
        });
        this.all_user_names = user;
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
        const storedOpenedTasks = JSON.parse(sessionStorage.getItem("opened_tasks"));
        this.data.forEach(task => {
            switch (this.metaData.resModel) {

                case "project.project":
                    const _ta = {
                        id: task.id,
                        text: task.name,
                        start_date: task.exact_start_date,
                        end_date: task.exact_end_date,
                        // duration:5,
                        parent: 0,
                        progress: task.project_progress / 100,
                        model: "project.project",
                        type: "custom_project"
                    }
                    if (task.exact_start_date === false) {
                        _ta.start_date = this.now
                    }
                    if (task.exact_end_date === false) {
                        _ta.end_date = this.now
                    }
                    data.push(_ta)
                    break;
                case "project.task":
                    const _task = {
                        id: task.id,
                        text: task.name,
                        start_date: task.date_start ? task.date_start : task.assign,
                        end_date: task.date_deadline,
                        parent: task.parent_id[0],
                        progress: task.progress / 100,
                        type: "task",
                        user: task.portal_user_names,
                        model: "project.task",
                        open: false,
                        multiple_asssign: task.user_ids,
                        personal_stage_typeid: task.personal_stage_type_id,
                    }

                    if (task.child_ids.length > 0) {
                        if (storedOpenedTasks && storedOpenedTasks.length > 0) {
                            storedOpenedTasks.forEach(taskId => {
                                if (task.id === Number(taskId)) {
                                    _task.open = true
                                }
                            });
                        }
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
                    id: 'MLT' + milestone.id,
                    text: milestone.name,
                    start_date: milestone.deadline ? milestone.deadline : new Date(),
                    end_date: milestone.reached_date ? milestone.reached_date : new Date(),
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
