var scripty = require('azure-scripty'),
  conf = require('./config'),
  RSVP = require('rsvp'),
  fs = require('fs'),
  debug = require('debug')('arm-validator:azure'),
  mongoHelper = require('./mongo_helper');

var invoke = RSVP.denodeify(scripty.invoke);

exports.login = function () {
  var cmd = {
      command: 'login --service-principal',
      username: conf.get('AZURE_CLIENT_ID'),
      password: conf.get('AZURE_CLIENT_SECRET'),
      tenant: conf.get('AZURE_TENANT_ID')
    },
    arm = {
      command: 'config mode arm'
    };
  return invoke.call(scripty, cmd)
    .then(invoke.call(scripty, arm));
};

exports.validateTemplate = function (templateFile, parametersFile) {
  var cmd = {
    command: 'group template validate',
    'resource-group': conf.get('TEST_RESOURCE_GROUP_NAME'),
    'template-file': templateFile,
    'parameters-file': parametersFile
  };
  debug('DEBUG: using template file:');
  debug(templateFile);
  debug('using paramters:');
  debug(parametersFile);
  return invoke.call(scripty, cmd);
};

function createGroup(groupName) {
  debug('creating resource group: ' + groupName + ' in region ' + conf.get('AZURE_REGION'));
  var cmd = {
    command: 'group create',
    positional: [groupName, conf.get('AZURE_REGION')]
  };
  return invoke.call(scripty, cmd);
}

exports.deleteExistingGroups = function () {
  return mongoHelper.connect()
    .then(db => {
      var resourceGroups = db.collection('resourceGroups');
      var find = RSVP.denodeify(resourceGroups.find);
      return find.call(resourceGroups, {});
    })
    .then(results => {
      var promises = [];
      results.forEach(result => {
        var promise = exports.deleteGroup(result.name);
        promises.push(promise);
      });

      return RSVP.all(promises);
    });
};

exports.deleteGroup = function (groupName) {
  var cmd = {
    command: 'group delete',
    quiet: '',
    positional: [groupName]
  };
  // first, remove tracking entry in db
  return mongoHelper.connect()
    .then(db => {
      debug('deleting resource group: ' + groupName);
      var resourceGroups = db.collection('resourceGroups');
      var deleteOne = RSVP.denodeify(resourceGroups.deleteOne);
      return deleteOne.call(resourceGroups, {
        name: groupName
      });
    })
    .then(() => invoke.call(scripty, cmd))
    .then(() => debug('sucessfully deleted resource group: ' + groupName));
};

exports.testTemplate = function (rgName, templateFile, parametersFile) {
  debug('DEBUG: using template file:');
  debug(templateFile);
  debug('using paramters:');
  debug(parametersFile);
  debug('Deploying to RG: ' + rgName);

  return mongoHelper.connect()
    .then(db => {
      var resourceGroups = db.collection('resourceGroups');
      var insert = RSVP.denodeify(resourceGroups.insert);
      return insert.call(resourceGroups, {
        name: rgName,
        region: rgName
      });
    })
    .then(result => {
      debug('sucessfully inserted ' + result.ops.length + ' resource group to collection');
      return createGroup(rgName);
    })
    .then(() => {
      debug('sucessfully created resource group ' + rgName);

      var cmd = {
        command: 'group deployment create',
        'resource-group': rgName,
        'template-file': templateFile,
        'parameters-file': parametersFile
      };
      // now deploy!
      return invoke.call(scripty, cmd);
    });
};

exports.testTemplateWithPreReq = function (rgName, templateFile, parametersFile, preReqTemplateFile, preReqParametersFile) {
  debug('DEBUG: using prereq template file:');
  debug(preReqTemplateFile);
  debug('using prereq template parameters:');
  debug(preReqParametersFile);
  debug('DEBUG: using template file:');
  debug(templateFile);
  debug('using paramters:');
  debug(parametersFile);
  debug('Deploying to RG: ' + rgName);

  return mongoHelper.connect()
    .then(db => {
      var resourceGroups = db.collection('resourceGroups');
      var insert = RSVP.denodeify(resourceGroups.insert);
      return insert.call(resourceGroups, {
        name: rgName,
        region: rgName
      });
    })
    .then(result => {
      debug('sucessfully inserted ' + result.ops.length + ' resource group to collection');
      return createGroup(rgName);
    })
    .then(() => {
      debug('sucessfully created resource group ' + rgName);

      var cmd = {
        command: 'group deployment create',
        'resource-group': rgName,
        'template-file': preReqTemplateFile,
        'parameters-file': preReqParametersFile
      };
      // now deploy!
      return invoke.call(scripty, cmd);
    })
    .then((response) => {
      debug('sucessfully deployed prereq resources');

      // Handle string replacement based pre-req mapping
      var parametersString = fs.readFileSync(parametersFile, 'utf8');
      for (var key in response.properties.outputs) {
        debug('key: ' + key);
        debug('Value: ' + response.properties.outputs[key].value);
        var keyValue = response.properties.outputs[key].value;
        parametersString = parametersString.replace(new RegExp('GET-PREREQ-' + key, 'g'), keyValue);
      }
      
      ////// Handle dynamic pre-req mapping based on name mapping
      ////var parametersObject = JSON.parse(parametersString);
      ////for (var key in response.properties.outputs) {
      ////  if (parametersObject.parameters[key]) {
      ////    parametersObject.parameters[key].value = response.properties.outputs[key].value;
      ////  }
      ////}
      ////parametersString = JSON.stringify(parametersObject);

      fs.writeFileSync(parametersFile, parametersString, 'utf8');

      var cmd = {
        command: 'group deployment create',
        'resource-group': rgName,
        'template-file': templateFile,
        'parameters-file': parametersFile
      };
      // now deploy!
      return invoke.call(scripty, cmd);
    });
};
